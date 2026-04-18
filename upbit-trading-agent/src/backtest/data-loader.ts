/**
 * 백테스트 데이터 로더
 *
 * - 업비트 공개 API에서 일봉·60분봉을 페이지네이션으로 수집
 * - data/backtest-cache/ 에 JSON 캐시 저장 (일봉 8h, 시간봉 2h TTL)
 * - 인증 불필요 (캔들 데이터는 공개 API)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../types/upbit.types';
import { DailyBar, HourlyBar, CachedData } from './types';

// ── 상수 ─────────────────────────────────────────────────────────────────────

const CACHE_DIR           = path.resolve(process.cwd(), 'data', 'backtest-cache');
const DAILY_TTL_MS        = 8  * 60 * 60 * 1000;  // 8시간
const HOURLY_TTL_MS       = 2  * 60 * 60 * 1000;  // 2시간
const REQUEST_INTERVAL_MS = 130;                    // ~7.7 req/s (공개 한도: 10/s)
const MAX_PER_REQUEST     = 200;
const BASE_URL            = 'https://api.upbit.com/v1';
const MAX_RETRIES         = 3;
const RETRY_BASE_MS       = 1_500;

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function toDailyBar(c: Candle): DailyBar {
  return {
    market:      c.market,
    dateKst:     c.candle_date_time_kst.slice(0, 10),
    open:        c.opening_price,
    high:        c.high_price,
    low:         c.low_price,
    close:       c.trade_price,
    volume:      c.candle_acc_trade_volume,
    timestampMs: c.timestamp,
  };
}

function toHourlyBar(c: Candle): HourlyBar {
  const kst = c.candle_date_time_kst;
  return {
    market:      c.market,
    datetimeKst: kst,
    dateKst:     kst.slice(0, 10),
    open:        c.opening_price,
    high:        c.high_price,
    low:         c.low_price,
    close:       c.trade_price,
    volume:      c.candle_acc_trade_volume,
  };
}

// ── BacktestDataLoader ────────────────────────────────────────────────────────

export class BacktestDataLoader {
  private lastRequestAt = 0;

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async get<T>(
    url: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await axios.get<T>(`${BASE_URL}${url}`, {
          params,
          timeout: 15_000,
        });
        return res.data;
      } catch (err: unknown) {
        const isLast = attempt === MAX_RETRIES;
        // 재시도 가능 조건: 네트워크 오류, 429, 5xx
        const status = (err as { response?: { status?: number } }).response?.status;
        const isRetryable = status === undefined || status === 429 || (status >= 500);
        if (isLast || !isRetryable) throw err;
        const delay = RETRY_BASE_MS * Math.pow(2, attempt); // 지수 백오프: 1.5s, 3s, 6s
        process.stdout.write(`  [재시도] ${url} (${attempt + 1}/${MAX_RETRIES}) ${delay}ms 대기...\n`);
        await sleep(delay);
        this.lastRequestAt = Date.now(); // 재시도 후 인터벌 재설정
      }
    }
    // 컴파일러를 위한 폴백 — 실제로는 도달하지 않음
    throw new Error(`[DataLoader] ${url} 요청 실패`);
  }

  // ── 페이지네이션 조회 ─────────────────────────────────────────────────────

  /**
   * 일봉 N개 조회 (최신 → 과거 방향으로 페이징)
   * 중복 캔들은 timestamp 기준으로 제거합니다.
   */
  private async fetchRawDaily(market: string, count: number): Promise<Candle[]> {
    const result: Candle[] = [];
    const seen  = new Set<number>();
    let to: string | undefined;

    while (result.length < count) {
      const batchSize = Math.min(count - result.length, MAX_PER_REQUEST);
      const params: Record<string, string | number> = { market, count: batchSize };
      if (to !== undefined) params['to'] = to;

      const batch = await this.get<Candle[]>('/candles/days', params);
      if (batch.length === 0) break;

      let added = 0;
      for (const c of batch) {
        if (!seen.has(c.timestamp)) {
          seen.add(c.timestamp);
          result.push(c);
          added++;
        }
      }
      if (added === 0) break; // 더 이상 새 캔들 없음

      // 다음 페이지: 현재 배치의 가장 오래된 캔들 기준
      to = batch[batch.length - 1]!.candle_date_time_utc;
    }

    return result;
  }

  /**
   * 60분봉 N개 조회 (최신 → 과거 방향으로 페이징)
   */
  private async fetchRawHourly(market: string, count: number): Promise<Candle[]> {
    const result: Candle[] = [];
    const seen  = new Set<number>();
    let to: string | undefined;

    while (result.length < count) {
      const batchSize = Math.min(count - result.length, MAX_PER_REQUEST);
      const params: Record<string, string | number> = { market, count: batchSize };
      if (to !== undefined) params['to'] = to;

      const batch = await this.get<Candle[]>('/candles/minutes/60', params);
      if (batch.length === 0) break;

      let added = 0;
      for (const c of batch) {
        if (!seen.has(c.timestamp)) {
          seen.add(c.timestamp);
          result.push(c);
          added++;
        }
      }
      if (added === 0) break;

      to = batch[batch.length - 1]!.candle_date_time_utc;
    }

    return result;
  }

  // ── 캐시 ─────────────────────────────────────────────────────────────────

  private cachePath(market: string, type: 'daily' | 'hourly', days: number): string {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const key = market.replace('-', '_');
    return path.join(CACHE_DIR, `${key}_${type}_${days}d.json`);
  }

  private loadCache<T>(p: string, ttlMs: number): T | null {
    try {
      const raw    = fs.readFileSync(p, 'utf-8');
      const cached = JSON.parse(raw) as CachedData<T>;
      if (Date.now() - cached.fetchedAt < ttlMs) return cached.data;
    } catch { /* 캐시 미스 */ }
    return null;
  }

  private saveCache<T>(p: string, data: T): void {
    fs.writeFileSync(p, JSON.stringify({ fetchedAt: Date.now(), data }), 'utf-8');
  }

  // ── 공개 API ─────────────────────────────────────────────────────────────

  /**
   * 일봉 로드 (캐시 → API 순서)
   * 반환 순서: 오래된 것 → 최신 (오름차순)
   * @param days 테스트 기간 (일). 신호 분석 여유분 70일을 자동으로 추가합니다.
   */
  async getDailyBars(market: string, days: number): Promise<DailyBar[]> {
    const needed   = days + 70; // SignalAnalyzer 최소 62개 + 여유
    const cPath    = this.cachePath(market, 'daily', days);
    const cached   = this.loadCache<DailyBar[]>(cPath, DAILY_TTL_MS);
    if (cached !== null) return cached;

    process.stdout.write(`  [데이터] ${market} 일봉 ${needed}개 조회 중...`);
    const raw  = await this.fetchRawDaily(market, needed);
    const bars = raw.map(toDailyBar).reverse(); // 오래된 것 → 최신
    this.saveCache(cPath, bars);
    process.stdout.write(` ${bars.length}개 완료\n`);
    return bars;
  }

  /**
   * 60분봉 로드 (캐시 → API 순서)
   * 반환 순서: 오래된 것 → 최신 (오름차순)
   */
  async getHourlyBars(market: string, days: number): Promise<HourlyBar[]> {
    const needed = days * 24 + 48; // 여유 2일 추가
    const cPath  = this.cachePath(market, 'hourly', days);
    const cached = this.loadCache<HourlyBar[]>(cPath, HOURLY_TTL_MS);
    if (cached !== null) return cached;

    process.stdout.write(`  [데이터] ${market} 60분봉 ${needed}개 조회 중...`);
    const raw  = await this.fetchRawHourly(market, needed);
    const bars = raw.map(toHourlyBar).reverse();
    this.saveCache(cPath, bars);
    process.stdout.write(` ${bars.length}개 완료\n`);
    return bars;
  }
}
