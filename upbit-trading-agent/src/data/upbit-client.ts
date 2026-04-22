/**
 * 업비트 REST API 클라이언트
 *
 * - JWT 인증 토큰 생성
 * - Token Bucket 기반 Rate Limiting (공개 10req/s, 사설 5req/s)
 * - Exponential Backoff + Jitter 재시도
 * - API 레벨 서킷 브레이커
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios'
import * as jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import * as crypto from 'crypto'
import {
  Account, Market, Ticker, Candle, Orderbook, Order, OrderRequest, UpbitApiError,
} from '../types/upbit.types'
import { PortfolioSummary, RateLimitStatus } from '../types/agent.types'
import { logger } from '../utils/logger'

// ─── 유틸 ─────────────────────────────────────
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

// ─── Token Bucket Rate Limiter ────────────────

class TokenBucketRateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillPerMs: number

  constructor(maxTokens: number, refillPerSecond: number) {
    this.maxTokens = maxTokens
    this.tokens = maxTokens
    this.refillPerMs = refillPerSecond / 1000
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerMs)
    this.lastRefill = now
  }

  async acquire(tokens = 1): Promise<void> {
    while (true) {
      this.refill()
      if (this.tokens >= tokens) {
        this.tokens -= tokens
        return
      }
      const waitMs = Math.ceil((tokens - this.tokens) / this.refillPerMs)
      await sleep(waitMs)
    }
  }

  getAvailable(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}

// ─── API Circuit Breaker ──────────────────────

type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

class ApiCircuitBreaker {
  private state: CbState = 'CLOSED'
  private failures = 0
  private lastOpenedAt = 0

  constructor(
    private readonly threshold: number,
    private readonly recoveryMs: number,
  ) {}

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastOpenedAt >= this.recoveryMs) {
        this.state = 'HALF_OPEN'
        return false
      }
      return true
    }
    return false
  }

  onSuccess(): void {
    this.failures = 0
    this.state = 'CLOSED'
  }

  onFailure(): void {
    this.failures++
    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
      this.lastOpenedAt = Date.now()
      logger.error(
        `[ApiCircuitBreaker] OPEN — ${this.failures}회 연속 실패. ${this.recoveryMs / 1000}초 후 재시도.`,
      )
    }
  }

  getState(): CbState {
    return this.state
  }
}

// ─── Retry 설정 ───────────────────────────────

interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryOn: number[]
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  retryOn: [408, 429, 500, 502, 503, 504],
}

// ─── UpbitClient ──────────────────────────────

export interface UpbitClientConfig {
  accessKey: string
  secretKey: string
  cbFailureThreshold?: number
  cbRecoveryMs?: number
  retry?: Partial<RetryConfig>
}

export class UpbitClient {
  private readonly http: AxiosInstance
  private readonly accessKey: string
  private readonly secretKey: string
  private readonly circuitBreaker: ApiCircuitBreaker
  private readonly retry: RetryConfig
  private readonly publicLimiter = new TokenBucketRateLimiter(10, 10)
  private readonly privateLimiter = new TokenBucketRateLimiter(5, 5)
  private currentSignal: AbortSignal | undefined = undefined

  constructor(config: UpbitClientConfig) {
    this.accessKey = config.accessKey
    this.secretKey = config.secretKey
    this.circuitBreaker = new ApiCircuitBreaker(
      config.cbFailureThreshold ?? 5,
      config.cbRecoveryMs ?? 30_000,
    )
    this.retry = { ...DEFAULT_RETRY, ...config.retry }
    this.http = axios.create({
      baseURL: 'https://api.upbit.com/v1',
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private generateToken(queryString?: string): string {
    const payload: Record<string, string> = {
      access_key: this.accessKey,
      nonce: uuidv4(),
    }
    if (queryString !== undefined) {
      const hash = crypto.createHash('sha512').update(queryString, 'utf8').digest('hex')
      payload['query_hash'] = hash
      payload['query_hash_alg'] = 'SHA512'
    }
    return `Bearer ${jwt.sign(payload, this.secretKey)}`
  }

  private async request<T>(
    config: AxiosRequestConfig & { isPrivate?: boolean },
  ): Promise<T> {
    if (this.circuitBreaker.isOpen()) {
      throw new Error(
        `[UpbitClient] API 서킷 브레이커 OPEN. 상태: ${this.circuitBreaker.getState()}`,
      )
    }

    if (config.isPrivate === true) {
      await this.privateLimiter.acquire()
    } else {
      await this.publicLimiter.acquire()
    }

    let lastError: Error = new Error('Unknown error')

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        const axiosConfig: AxiosRequestConfig = { ...config }
        if (this.currentSignal !== undefined) {
          axiosConfig.signal = this.currentSignal
        }
        const response = await this.http.request<T>(axiosConfig)
        this.circuitBreaker.onSuccess()
        return response.data as T
      } catch (err) {
        const axiosErr = err as AxiosError<UpbitApiError>
        lastError = this.normalizeError(axiosErr)
        const status = axiosErr.response?.status

        if (status !== undefined && !this.retry.retryOn.includes(status)) {
          this.circuitBreaker.onFailure()
          throw lastError
        }

        if (attempt < this.retry.maxRetries) {
          const base = this.retry.baseDelayMs * Math.pow(2, attempt)
          const jitter = Math.random() * this.retry.baseDelayMs
          const delay = Math.min(base + jitter, this.retry.maxDelayMs)
          logger.warn(
            `[UpbitClient] 재시도 ${attempt + 1}/${this.retry.maxRetries} — ${Math.round(delay)}ms 후. 원인: ${lastError.message}`,
          )
          await sleep(delay)
        }
      }
    }

    this.circuitBreaker.onFailure()
    throw lastError
  }

  private normalizeError(err: AxiosError<UpbitApiError>): Error {
    if (err.response?.data?.error) {
      const { name, message } = err.response.data.error
      return new Error(`[UpbitAPI] ${name}: ${message}`)
    }
    if (err.code === 'ECONNABORTED') return new Error('[UpbitClient] 요청 타임아웃')
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return new Error('[UpbitClient] 네트워크 연결 실패')
    }
    return new Error(`[UpbitClient] ${err.message}`)
  }

  // ─── 사설 API ─────────────────────────────────

  async getAccounts(): Promise<Account[]> {
    return this.request<Account[]>({
      method: 'GET',
      url: '/accounts',
      headers: { Authorization: this.generateToken() },
      isPrivate: true,
    })
  }

  async createOrder(order: OrderRequest): Promise<Order> {
    const queryString = new URLSearchParams(
      Object.entries(order).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString()
    return this.request<Order>({
      method: 'POST',
      url: '/orders',
      data: order,
      headers: { Authorization: this.generateToken(queryString) },
      isPrivate: true,
    })
  }

  async cancelOrder(uuid: string): Promise<Order> {
    return this.request<Order>({
      method: 'DELETE',
      url: '/order',
      params: { uuid },
      headers: { Authorization: this.generateToken(`uuid=${uuid}`) },
      isPrivate: true,
    })
  }

  async getOrder(uuid: string): Promise<Order> {
    return this.request<Order>({
      method: 'GET',
      url: '/order',
      params: { uuid },
      headers: { Authorization: this.generateToken(`uuid=${uuid}`) },
      isPrivate: true,
    })
  }

  // ─── 공개 API ─────────────────────────────────

  async getMarkets(): Promise<Market[]> {
    return this.request<Market[]>({
      method: 'GET',
      url: '/market/all',
      params: { isDetails: false },
    })
  }

  async getTicker(markets: string[]): Promise<Ticker[]> {
    return this.request<Ticker[]>({
      method: 'GET',
      url: '/ticker',
      params: { markets: markets.join(',') },
    })
  }

  async getMinuteCandles(market: string, unit: number, count = 200): Promise<Candle[]> {
    return this.request<Candle[]>({
      method: 'GET',
      url: `/candles/minutes/${unit}`,
      params: { market, count: Math.min(count, 200) },
    })
  }

  async getDayCandles(market: string, count = 200): Promise<Candle[]> {
    return this.request<Candle[]>({
      method: 'GET',
      url: '/candles/days',
      params: { market, count: Math.min(count, 200) },
    })
  }

  async getOrderbook(markets: string[]): Promise<Orderbook[]> {
    return this.request<Orderbook[]>({
      method: 'GET',
      url: '/orderbook',
      params: { markets: markets.join(',') },
    })
  }

  // ─── 도메인 메서드 ────────────────────────────

  /**
   * BTC 시장 상태 조회 (신규 매수 차단 판단용)
   *  - hourlyChangeRate: 직전 1시간봉 대비 등락률
   */
  async getBtcCondition(): Promise<{ hourlyChangeRate: number }> {
    const hourlyCandles = await this.getMinuteCandles('KRW-BTC', 60, 3)

    const cur  = hourlyCandles[0]
    const prev = hourlyCandles[1]
    const hourlyChangeRate =
      cur !== undefined && prev !== undefined
        ? (cur.trade_price - prev.trade_price) / prev.trade_price
        : 0

    return { hourlyChangeRate }
  }

  /**
   * 화이트리스트 중 24h 거래대금 상위 N개 마켓 반환
   */
  async getTopKrwMarketsByVolume(n: number, whitelist: string[]): Promise<string[]> {
    const tickers = await this.getTicker(whitelist)
    return tickers
      .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h)
      .slice(0, n)
      .map(t => t.market)
  }

  // ─── 편의 메서드 ──────────────────────────────

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    const accounts = await this.getAccounts()
    const krw = accounts.find(a => a.currency === 'KRW')
    const holdings = accounts
      .filter(a => a.currency !== 'KRW' && parseFloat(a.balance) > 0)
      .map(a => ({
        currency: a.currency,
        balance: parseFloat(a.balance),
        avgBuyPrice: parseFloat(a.avg_buy_price),
      }))
    return {
      krwAvailable: krw !== undefined ? parseFloat(krw.balance) : 0,
      krwLocked: krw !== undefined ? parseFloat(krw.locked) : 0,
      holdings,
    }
  }

  getRateLimitStatus(): RateLimitStatus {
    return {
      privateAvailable: this.privateLimiter.getAvailable(),
      publicAvailable: this.publicLimiter.getAvailable(),
    }
  }

  /** 사이클 단위 AbortSignal 주입 — 타임아웃 시 진행 중인 요청 전부 취소 */
  setAbortSignal(signal: AbortSignal | undefined): void {
    this.currentSignal = signal
  }

  getCircuitBreakerState(): CbState {
    return this.circuitBreaker.getState()
  }
}

// ─── 팩토리 ───────────────────────────────────

export function getUpbitClient(): UpbitClient {
  const accessKey = process.env['UPBIT_ACCESS_KEY']
  const secretKey = process.env['UPBIT_SECRET_KEY']

  if (!accessKey || !secretKey) {
    throw new Error(
      '[UpbitClient] UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY 환경변수가 없습니다.\n' +
      '.env.example 을 복사하여 .env 파일을 만드세요.',
    )
  }

  return new UpbitClient({
    accessKey,
    secretKey,
    cbFailureThreshold: Number(process.env['CIRCUIT_FAILURE_THRESHOLD'] ?? 5),
    cbRecoveryMs: Number(process.env['CIRCUIT_RESET_TIMEOUT_MS'] ?? 60_000),
  })
}
