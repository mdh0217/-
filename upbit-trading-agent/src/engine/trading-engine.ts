/**
 * 지능형 가상 매매 엔진 (Paper Trading Engine)
 *
 * 로그 정책: 엔진 시작/종료 · BTC 방어 차단 · 주문 체결 · 감시 목록 변경 시에만 출력
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { UpbitClient } from '../data/upbit-client';
import { DatabaseManager, getDatabase, calcBuyVolume, calcSellReceive } from '../database/db';
import { TRADING, ENGINE } from '../config/constants';
import { env } from '../config/env';
import { krw, pct } from '../utils/format';
import { SignalAnalyzer } from './signal-analyzer';
import {
  checkStopLoss,
  evalTrailingStop,
  shouldDCA,
  MAX_DCA_COUNT,
} from './position-manager';
import { Position, PositionEntry, SignalAnalysis } from '../types/index';
import { notifyEngineStart, notifyBuy, notifySell, notifyWarning, notifyDailyReport } from '../notifications/discord';
import { DailyLossGuard } from '../core/daily-loss-guard';
import { logger } from '../utils/logger';
import { writeStatusFile, MarketStatus, SignalStrength } from '../utils/statusFile';

// ── 설정 상수 ─────────────────────────────────────────────────────────────────

const CYCLE_TIMEOUT_MS       = ENGINE.CYCLE_TIMEOUT_MS;
const COOLDOWN_TIMEOUT_COUNT = ENGINE.COOLDOWN_TIMEOUT_COUNT;
const COOLDOWN_MS            = ENGINE.COOLDOWN_MS;
const STALE_DATA_MS          = ENGINE.STALE_DATA_MS;
const SPREAD_THRESHOLD       = TRADING.SPREAD_THRESHOLD;
const STOP_LOSS_RATE         = TRADING.STOP_LOSS_RATE;
const SNAPSHOTS_DIR          = path.resolve(process.cwd(), 'data', 'snapshots');

const TOP_N_MARKETS      = env.topNMarkets;
const BTC_DROP_THRESHOLD = TRADING.BTC_DROP_THRESHOLD;
const FIXED_MARKETS      = env.targetMarkets;

/**
 * 감시 대상 메이저 코인 화이트리스트
 * - 거래대금 상위 + 높은 신뢰도 기준으로 선정한 15종목
 * - 잡코인·스테이블코인 제외, getTicker 1회 조회로 완료 (API 절약)
 * - TARGET_MARKETS 환경변수로 오버라이드 가능
 */
/**
 * 감시 대상 마켓 화이트리스트 (365일 백테스트 기반 선별)
 *
 * 제외 기준 (N=20 전략 기준 지속적 언더퍼폼):
 *   KRW-ETH  — 학습 샤프 -0.72, 전략과 N값 불일치
 *   KRW-AVAX — 35% 승률, 365일 -30M KRW
 *   KRW-BCH  — 38% 승률, 365일 -29M KRW
 *   KRW-ETC  — 41% 승률, 일관된 손실
 *   KRW-ATOM — 22% 승률, 최악의 퍼포먼스
 */
const MAJOR_KRW_MARKETS: string[] = [
  'KRW-BTC',   // Bitcoin    — 최우수 (OOS 샤프 1.88, 승률 77%)
  'KRW-XRP',   // Ripple     — 우수 (승률 62%)
  'KRW-SOL',   // Solana     — 유지 (N=15 최적)
  'KRW-DOGE',  // Dogecoin   — 우수 (OOS 샤프 2.36)
  'KRW-ADA',   // Cardano    — 유지 (승률 57%)
  'KRW-LINK',  // Chainlink  — 우수 (학습 샤프 2.11, N=20 최적)
  'KRW-TRX',   // TRON       — 유지 (승률 56%)
  'KRW-DOT',   // Polkadot   — 유지 (학습 샤프 2.27)
  'KRW-STX',   // Stacks     — 유지 (학습 샤프 2.24)
  'KRW-SUI',   // Sui        — 우수 (학습 샤프 2.88)
];

// ══════════════════════════════════════════════════════════════════════════════

export class TradingEngine {
  private db!: DatabaseManager;
  private readonly analyzer = new SignalAnalyzer();
  private markets: string[];
  private iteration           = 0;
  private running             = false;
  private consecutiveTimeouts = 0;
  private cyclePromise: Promise<void> | null = null;

  private readonly dailyLossGuard = new DailyLossGuard(env.dailyLossLimit);

  /** 매도 진행 중인 포지션 ID (중복 처리 방지) */
  private readonly sellingPositions = new Set<number>();
  /** 최근 알림을 보낸 포지션 ID → 타임스탬프 (중복 알림 방지, 10초 쿨다운) */
  private readonly recentNotifications = new Map<number, number>();
  private static readonly NOTIFY_COOLDOWN_MS = 10_000;

  /** 경고 알림 중복 방지 (사유 키 → 마지막 발송 시각, 10분 쿨다운) */
  private readonly warningSentAt = new Map<string, number>();
  private static readonly WARNING_COOLDOWN_MS = 10 * 60_000;

  /** 일별 리포트 중복 방지 (KST 날짜 문자열) */
  private lastDailyReportDate = '';

  constructor(
    private readonly client: UpbitClient,
    markets?: string[],
  ) {
    this.markets = markets ?? FIXED_MARKETS ?? MAJOR_KRW_MARKETS;
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.db = await getDatabase();
    if (!this.db.getBalance('KRW')) {
      const initial = env.initialKrw;
      this.db.setBalance('KRW', initial, 0);
    }
  }

  // ── 스냅샷 ───────────────────────────────────────────────────────────────────

  private saveSnapshot(reason: string): void {
    try {
      const krwBalance = this.db.getBalance('KRW');
      const positions  = this.db.getAllOpenPositions();
      const snapshot   = {
        savedAt:       new Date().toISOString(),
        reason,
        balance:       krwBalance,
        openPositions: positions,
      };
      const now = new Date();
      const ts  =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
      const filename = `snapshot_${ts}.json`;
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), JSON.stringify(snapshot, null, 2));
    } catch {
      // best-effort
    }
  }

  // ── 루프 진입점 ───────────────────────────────────────────────────────────

  async start(intervalMs = 60_000): Promise<void> {
    this.running = true;
    logger.info(`[시작] 엔진 가동 — ${intervalMs / 1000}s 간격 | 대상 ${this.markets.join(', ')}`);

    const krwBal        = this.db.getBalance('KRW');
    const openPositions = this.db.getAllOpenPositions();
    const totalInvested = openPositions.reduce((s, p) => s + p.total_invested, 0);
    void notifyEngineStart({
      krwBalance:    krwBal?.available ?? 0,
      markets:       this.markets,
      intervalSec:   intervalMs / 1000,
      totalInvested,
    });

    while (this.running) {
      this.cyclePromise = this.runOnce();
      await this.cyclePromise;
      this.cyclePromise = null;
      if (this.running) await sleep(intervalMs);
    }
  }

  stop(): void {
    this.running = false;
    logger.info('[종료] 정지 신호 수신');
  }

  /**
   * 현재 실행 중인 runOnce() 사이클이 끝날 때까지 대기합니다.
   * 사이클이 없으면 즉시 반환합니다.
   * timeoutMs 안에 끝나지 않으면 강제로 반환합니다 (타임아웃).
   */
  async waitForCurrentCycle(timeoutMs = 55_000): Promise<void> {
    if (!this.cyclePromise) return;
    await Promise.race([
      this.cyclePromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  // ── 단일 순환 (타임아웃 래퍼) ────────────────────────────────────────────

  async runOnce(): Promise<void> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // 50초 후 모든 진행 중인 요청 강제 중단
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('CYCLE_TIMEOUT'));
      }, CYCLE_TIMEOUT_MS);
    });

    this.client.setAbortSignal(controller.signal);

    try {
      await Promise.race([this.runOnceCore(controller.signal), timeoutPromise]);
      this.consecutiveTimeouts = 0;
    } catch (err) {
      if ((err as Error).message === 'CYCLE_TIMEOUT') {
        const msg = `⚠️ 무응답으로 인한 사이클 강제 종료 (#${this.iteration})`;
        logger.error(msg);
        this.saveSnapshot('cycle_timeout');

        this.consecutiveTimeouts++;
        if (this.consecutiveTimeouts >= COOLDOWN_TIMEOUT_COUNT) {
          const coolMsg =
            `연속 타임아웃 ${this.consecutiveTimeouts}회 — ` +
            `${COOLDOWN_MS / 60_000}분 쿨다운 시작`;
          logger.warn(`[쿨다운] ${coolMsg}`);
          if (this.canSendWarning('timeout_cooldown')) {
            void notifyWarning({ kind: 'timeout_cooldown', detail: coolMsg });
          }
          await sleep(COOLDOWN_MS);
          this.consecutiveTimeouts = 0;
          logger.info(`[재가동] 쿨다운 종료 — 루프를 재시작합니다`);
        }
      } else {
        throw err;
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.client.setAbortSignal(undefined);
    }
  }

  // ── 단일 순환 내부 로직 ────────────────────────────────────────────────────

  private async runOnceCore(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.iteration++;
    await this.refreshWatchList();

    if (signal.aborted) return;
    const marketBlock    = await this.checkMarketCondition();
    const krwBal         = this.db.getBalance('KRW');
    const openPos        = this.db.getAllOpenPositions();
    const totalInvested  = openPos.reduce((s, p) => s + p.total_invested, 0);
    const dailyGuard     = this.dailyLossGuard.check(krwBal?.available ?? 0, totalInvested);
    const blocked = marketBlock.blocked || dailyGuard.breached;
    const reason  = marketBlock.blocked  ? marketBlock.reason
                  : dailyGuard.breached  ? `일일 손실 한도 도달 (${(dailyGuard.lossRate * 100).toFixed(2)}%)`
                  : '';
    if (blocked) {
      logger.warn(`[차단] #${this.iteration} 신규 매수 차단 — ${reason}`);
      const warnKey = marketBlock.blocked ? 'btc_drop' : 'daily_loss';
      if (this.canSendWarning(warnKey)) {
        void notifyWarning({
          kind:   marketBlock.blocked ? 'btc_drop' : 'daily_loss',
          detail: reason,
        });
      }
    }

    if (signal.aborted) return;

    // 전체 마켓 티커를 1회 배치 조회 (개별 호출 대신 → 공개 API 절약)
    interface TickerEntry { trade_price: number; timestamp: number }
    let tickerMap: Map<string, TickerEntry>;
    try {
      const tickers = await this.client.getTicker(this.markets);
      tickerMap = new Map(
        tickers.map((t) => [t.market, { trade_price: t.trade_price, timestamp: t.timestamp }]),
      );
    } catch {
      return; // 티커 조회 실패 시 이번 순환 스킵
    }

    // 종목을 순차 처리 — API 과부하 방지를 위해 종목 간 200ms 간격
    const marketResults: MarketStatus[] = [];

    for (const market of this.markets) {
      if (signal.aborted) break;

      const ticker = tickerMap.get(market);
      if (ticker !== undefined) {
        const ageMs = Date.now() - ticker.timestamp;
        try {
          const strength = await this.processMarket(market, ticker.trade_price, ageMs, blocked);
          marketResults.push({ market, signal: strength });
        } catch (err) {
          logger.warn(`[스킵] ${market}: ${(err as Error).message}`);
          marketResults.push({ market, signal: 'none' });
        }
      } else {
        marketResults.push({ market, signal: 'none' });
      }

      await sleep(200);
    }

    // ── 상태 전광판 기록 ─────────────────────────────────────────────────────
    if (!signal.aborted) {
      if (blocked) {
        writeStatusFile({ kind: 'blocked', reason, iteration: this.iteration });
      } else {
        writeStatusFile({ kind: 'ok', markets: marketResults, iteration: this.iteration });
      }
    }

    // ── DB 배치 저장 (사이클 당 1회) ────────────────────────────────────────
    this.db.flush();

    // ── 일별 리포트 (KST 08:00 이후 첫 사이클) ───────────────────────────────
    if (!signal.aborted) {
      const kstNow  = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const kstDate = kstNow.toISOString().slice(0, 10);
      const kstHour = kstNow.getUTCHours();
      if (kstHour >= 8 && kstDate !== this.lastDailyReportDate) {
        this.lastDailyReportDate = kstDate;
        const todayStats = this.db.getTodayStats();
        const summary    = this.db.getSummary();
        const krwBal2    = this.db.getBalance('KRW');
        const invested2  = this.db.getAllOpenPositions().reduce((s, p) => s + p.total_invested, 0);
        void notifyDailyReport({
          krwBalance:    krwBal2?.available ?? 0,
          totalInvested: invested2,
          todayTrades:   todayStats.trades,
          todayPnl:      todayStats.pnl,
          todayWins:     todayStats.wins,
          allTimeTrades: summary.totalTrades,
          allTimePnl:    summary.totalPnl,
        });
      }
    }
  }

  // ── BTC 하락장 방어 ───────────────────────────────────────────────────────

  private async checkMarketCondition(): Promise<{ blocked: boolean; reason: string }> {
    try {
      const btc = await this.client.getBtcCondition();

      if (btc.hourlyChangeRate <= BTC_DROP_THRESHOLD) {
        return {
          blocked: true,
          reason: `BTC 1h ${pct(btc.hourlyChangeRate)} 급락`,
        };
      }

      // ── 시장 국면 필터: BTC 일봉 종가 < 60MA → 하락 국면 차단 ──────────────
      const regimeBlocked = await this.checkRegimeFilter();
      if (regimeBlocked) {
        return {
          blocked: true,
          reason: `BTC 하락 국면 (일봉 종가 < ${TRADING.REGIME_MA_PERIOD}MA)`,
        };
      }

      return { blocked: false, reason: '' };
    } catch {
      // 조회 실패 시 차단하지 않음 (가용성 우선)
      return { blocked: false, reason: '' };
    }
  }

  private async checkRegimeFilter(): Promise<boolean> {
    try {
      const candles = await this.client.getDayCandles('KRW-BTC', TRADING.REGIME_MA_PERIOD + 1);
      if (candles.length < TRADING.REGIME_MA_PERIOD + 1) return false;

      const sorted    = [...candles].sort(
        (a, b) => new Date(a.candle_date_time_utc).getTime() - new Date(b.candle_date_time_utc).getTime(),
      );
      const todayClose = sorted[sorted.length - 1]!.trade_price;
      const maSlice    = sorted.slice(-TRADING.REGIME_MA_PERIOD - 1, -1);
      const ma         = maSlice.reduce((s, c) => s + c.trade_price, 0) / maSlice.length;

      return todayClose < ma;
    } catch {
      return false; // 조회 실패 시 차단하지 않음
    }
  }

  // ── 감시 목록 갱신 ────────────────────────────────────────────────────────

  private async refreshWatchList(): Promise<void> {
    if (FIXED_MARKETS) return;
    try {
      const topMarkets  = await this.client.getTopKrwMarketsByVolume(TOP_N_MARKETS, MAJOR_KRW_MARKETS);
      const heldMarkets = this.db.getAllOpenPositions().map((p) => p.market);

      // 보유 종목 우선, 이후 거래대금 순
      const merged = [...new Set([...heldMarkets, ...topMarkets])];

      const added   = merged.filter((m) => !this.markets.includes(m));
      const removed = this.markets.filter((m) => !merged.includes(m));

      if (added.length > 0 || removed.length > 0) {
        const parts: string[] = [];
        if (added.length)   parts.push(`+${added.join(',')}`);
        if (removed.length) parts.push(`-${removed.join(',')}`);
        logger.info(`[감시] ${parts.join('  ')}  (총 ${merged.length}종목)`);
        this.markets = merged;
      }
    } catch {
      // 갱신 실패 시 이전 목록 유지
    }
  }

  // ── 마켓 처리 ─────────────────────────────────────────────────────────────

  private async processMarket(
    market: string,
    tickerPrice: number,
    tickerAgeMs: number,
    buyBlocked: boolean,
  ): Promise<SignalStrength> {
    const candles  = await this.client.getDayCandles(market, 200);
    const signal   = this.analyzer.analyze(market, candles, tickerPrice);
    const position = this.db.getOpenPosition(market);

    if (position) {
      this.managePosition(position, tickerPrice, buyBlocked);
      return signal.signalStrength;
    }

    if (buyBlocked || signal.signalStrength === 'none') return signal.signalStrength;

    // 신선도 · 스프레드 검증 (호가창 1회 조회)
    const ok = await this.validateEntry(market, tickerPrice, tickerAgeMs);
    if (!ok) return signal.signalStrength;

    this.evaluateEntry(signal);
    return signal.signalStrength;
  }

  // ── 진입 시세 검증 (호가창 1회 조회) ────────────────────────────────────
  //   STEP 1: 티커 오래됨(>2분) → 호가창 신선도 교차 검증
  //   STEP 2: 스프레드 > 1.5% → 이상 시장으로 판단, 스킵

  private async validateEntry(
    market: string,
    tickerPrice: number,
    tickerAgeMs: number,
  ): Promise<boolean> {
    let obData;
    try {
      const books = await this.client.getOrderbook([market]);
      obData = books[0];
    } catch (err) {
      logger.warn(`[SKIP] ${market}: 호가창 조회 실패 — ${(err as Error).message}`);
      return false;
    }

    if (obData === undefined || obData.orderbook_units.length === 0) {
      logger.warn(`[SKIP] ${market}: 호가창 비어있음`);
      return false;
    }

    // STEP 1: 티커 신선도 — 오래됐으면 호가창도 함께 확인
    if (tickerAgeMs > STALE_DATA_MS) {
      const obAgeMs = Date.now() - obData.timestamp;
      if (obAgeMs > STALE_DATA_MS) {
        logger.warn(`[SKIP] ${market}: 호가창도 오래됨 (${Math.round(obAgeMs / 1000)}초 전)`);
        return false;
      }
      logger.info(
        `[검증] ${market}: 티커 오래됨(${Math.round(tickerAgeMs / 1000)}초)` +
        ` — 호가창 신선도 확인 완료 (${obData.orderbook_units[0]!.ask_price.toLocaleString('ko-KR')}원)`,
      );
    }

    // STEP 2: 스프레드 방어
    const unit0  = obData.orderbook_units[0]!;
    const spread = (unit0.ask_price - unit0.bid_price) / unit0.bid_price;
    if (spread > SPREAD_THRESHOLD) {
      logger.warn(
        `[SKIP] ${market}: 스프레드 과대` +
        ` (${(spread * 100).toFixed(2)}% > ${(SPREAD_THRESHOLD * 100).toFixed(1)}%)`,
      );
      return false;
    }

    return true;
  }

  // ── 포지션 관리 ───────────────────────────────────────────────────────────

  private managePosition(position: Position, currentPrice: number, buyBlocked: boolean): void {
    // 매도가 이미 진행 중인 포지션은 건드리지 않음
    if (this.sellingPositions.has(position.id)) return;

    if (checkStopLoss(position, currentPrice)) {
      this.executeStopLoss(position, currentPrice);
      return;
    }

    const trailing = evalTrailingStop(position, currentPrice);

    if (trailing.triggered) {
      this.executeTrailingStop(position, currentPrice, trailing.newPeak);
      return;
    }

    if (
      trailing.trailingActive !== position.trailing_active ||
      trailing.newPeak !== (position.peak_price ?? 0)
    ) {
      this.db.updateTrailingPeak(position.id, trailing.newPeak, trailing.trailingActive);
    }

    if (!buyBlocked && shouldDCA(position, currentPrice)) {
      this.executeDCA(position, currentPrice);
    }
  }

  // ── 진입 평가 ─────────────────────────────────────────────────────────────

  private evaluateEntry(signal: SignalAnalysis): void {
    if (signal.signalStrength === 'none') return;

    // 손절 쿨다운: 최근 N일 내 손절 횟수 초과 시 진입 차단
    // 쿼리 실패 시 진입 허용 (permissive fallback — 차단보다 허용이 더 안전)
    try {
      const recentStopLosses = this.db.getRecentStopLossCount(signal.market, TRADING.COOLDOWN_DAYS);
      if (recentStopLosses >= TRADING.COOLDOWN_LOSSES) {
        logger.warn(
          `[쿨다운] ${signal.market} 최근 ${TRADING.COOLDOWN_DAYS}일 내 손절 ${recentStopLosses}회 — 신규 진입 차단`,
        );
        return;
      }
    } catch {
      // DB 조회 실패 시 쿨다운 미적용 (루프 중단 방지 우선)
    }

    const maxPositions   = env.maxPositions;
    const openPositions  = this.db.getAllOpenPositions();
    if (openPositions.length >= maxPositions) return;

    const bal          = this.db.getBalance('KRW');
    const krwAvailable = bal?.available ?? 0;
    if (krwAvailable < 5000) return;

    this.executeInitialBuy(signal, krwAvailable);
  }

  // ── 알림 중복 방지 ────────────────────────────────────────────────────────

  /**
   * 동일 포지션에 대해 NOTIFY_COOLDOWN_MS 이내에 알림을 보낸 적 있으면 false 반환.
   * 중복 알림을 차단하고, 처음 호출 시 타임스탬프를 기록합니다.
   */
  private canNotify(positionId: number): boolean {
    const last = this.recentNotifications.get(positionId);
    const now  = Date.now();
    if (last !== undefined && now - last < TradingEngine.NOTIFY_COOLDOWN_MS) return false;
    this.recentNotifications.set(positionId, now);
    return true;
  }

  private canSendWarning(key: string): boolean {
    const last = this.warningSentAt.get(key);
    const now  = Date.now();
    if (last !== undefined && now - last < TradingEngine.WARNING_COOLDOWN_MS) return false;
    this.warningSentAt.set(key, now);
    return true;
  }

  // ── 주문 실행 ─────────────────────────────────────────────────────────────

  private executeInitialBuy(signal: SignalAnalysis, krwAvailable: number): void {
    const rate        = signal.recommendedPositionRate;
    const maxOrderKrw = env.maxOrderKrw;
    const krwAmt      = Math.min(Math.floor(krwAvailable * rate), maxOrderKrw);
    const { volume, fee } = calcBuyVolume(krwAmt, signal.currentPrice);

    const entry: PositionEntry = {
      dca_level: 0,
      price:     signal.currentPrice,
      volume,
      amount:    krwAmt,
      fee,
      timestamp: Date.now(),
    };

    const stopLoss = signal.currentPrice * (1 - STOP_LOSS_RATE);
    const pos      = this.db.createPosition({ market: signal.market, entry, stop_loss_price: stopLoss });
    this.db.deductKrw(krwAmt);

    this.db.logOrder({
      position_id: pos.id,
      market:      signal.market,
      side:        'buy',
      order_type:  'initial_buy',
      price:       signal.currentPrice,
      volume,
      amount:      krwAmt,
      fee,
      created_at:  new Date().toISOString(),
    });

    const tag = signal.signalStrength === 'strong' ? '강력' : '일반';
    logger.trade(
      `[매수] ${signal.market}  ${krw(signal.currentPrice)}` +
      `  ${volume.toFixed(6)}  투자 ${krw(krwAmt)} (${Math.round(rate * 100)}%)  ${tag}`,
    );

    const krwAfterBuy = this.db.getBalance('KRW');
    void notifyBuy({
      market:     signal.market,
      price:      signal.currentPrice,
      volume,
      amount:     krwAmt,
      krwBalance: krwAfterBuy?.available ?? 0,
      tag,
    });
  }

  private executeDCA(position: Position, currentPrice: number): void {
    const bal          = this.db.getBalance('KRW');
    const krwAvailable = bal?.available ?? 0;
    const dcaLevel     = position.dca_level + 1;

    const krwAmt = Math.min(
      Math.floor(position.total_invested / (position.dca_level + 1)),
      krwAvailable,
    );
    if (krwAmt < 5000) return;

    const { volume, fee } = calcBuyVolume(krwAmt, currentPrice);
    const newEntry: PositionEntry = {
      dca_level: dcaLevel,
      price:     currentPrice,
      volume,
      amount:    krwAmt,
      fee,
      timestamp: Date.now(),
    };

    const updated = this.db.addDcaEntry(position.id, newEntry);
    this.db.deductKrw(krwAmt);

    this.db.logOrder({
      position_id: position.id,
      market:      position.market,
      side:        'buy',
      order_type:  'dca_buy',
      price:       currentPrice,
      volume,
      amount:      krwAmt,
      fee,
      created_at:  new Date().toISOString(),
    });

    logger.trade(
      `[DCA${dcaLevel}/${MAX_DCA_COUNT}] ${position.market}  ${krw(currentPrice)}` +
      `  평단→${krw(updated.avg_price)}  추가 ${krw(krwAmt)}` +
      `  손절선→${krw(updated.stop_loss_price)} (강화 적용)`,
    );

    const krwAfterDca = this.db.getBalance('KRW');
    void notifyBuy({
      market:     position.market,
      price:      currentPrice,
      volume,
      amount:     krwAmt,
      krwBalance: krwAfterDca?.available ?? 0,
      tag:        `DCA${dcaLevel}/${MAX_DCA_COUNT}`,
    });
  }

  private executeStopLoss(position: Position, currentPrice: number): void {
    this.sellingPositions.add(position.id);
    try {
      const { received, fee } = calcSellReceive(position.total_volume, currentPrice);
      const pnl     = received - position.total_invested;
      const pnlRate = pnl / position.total_invested;

      this.db.closePosition(position.id, currentPrice, pnl, pnlRate, 'stop_loss');
      this.db.addKrw(received);
      this.db.logOrder({
        position_id: position.id,
        market:      position.market,
        side:        'sell',
        order_type:  'stop_loss_sell',
        price:       currentPrice,
        volume:      position.total_volume,
        amount:      received,
        fee,
        created_at:  new Date().toISOString(),
      });

      // 매도 상태 즉시 영속화 — 다음 사이클이 open으로 오판하지 않도록
      this.db.flush();

      logger.trade(
        `[손절] ${position.market}  ${krw(currentPrice)}  ${pct(pnlRate)}  ${krw(pnl)}`,
      );

      if (this.canNotify(position.id)) {
        const krwAfterSL    = this.db.getBalance('KRW');
        const remainInvested = this.db.getAllOpenPositions().reduce((s, p) => s + p.total_invested, 0);
        void notifySell({
          market:        position.market,
          price:         currentPrice,
          volume:        position.total_volume,
          pnl,
          pnlRate,
          krwBalance:    krwAfterSL?.available ?? 0,
          totalInvested: remainInvested,
          reason:        'stop_loss',
        });
      }
    } catch (err) {
      this.sellingPositions.delete(position.id);
      throw err;
    } finally {
      this.sellingPositions.delete(position.id);
    }
  }

  private executeTrailingStop(position: Position, currentPrice: number, peak: number): void {
    this.sellingPositions.add(position.id);
    try {
      const { received, fee } = calcSellReceive(position.total_volume, currentPrice);
      const pnl     = received - position.total_invested;
      const pnlRate = pnl / position.total_invested;

      this.db.closePosition(position.id, currentPrice, pnl, pnlRate, 'trailing_stop');
      this.db.addKrw(received);
      this.db.logOrder({
        position_id: position.id,
        market:      position.market,
        side:        'sell',
        order_type:  'trailing_stop_sell',
        price:       currentPrice,
        volume:      position.total_volume,
        amount:      received,
        fee,
        created_at:  new Date().toISOString(),
      });

      // 매도 상태 즉시 영속화 — 다음 사이클이 open으로 오판하지 않도록
      this.db.flush();

      logger.trade(
        `[익절] ${position.market}  고점 ${krw(peak)} → ${krw(currentPrice)}  ${pct(pnlRate)}  ${krw(pnl)}`,
      );

      if (this.canNotify(position.id)) {
        const krwAfterTS     = this.db.getBalance('KRW');
        const remainInvested = this.db.getAllOpenPositions().reduce((s, p) => s + p.total_invested, 0);
        void notifySell({
          market:        position.market,
          price:         currentPrice,
          volume:        position.total_volume,
          pnl,
          pnlRate,
          krwBalance:    krwAfterTS?.available ?? 0,
          totalInvested: remainInvested,
          reason:        'trailing_stop',
          peakPrice:     peak,
        });
      }
    } catch (err) {
      this.sellingPositions.delete(position.id);
      throw err;
    } finally {
      this.sellingPositions.delete(position.id);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
