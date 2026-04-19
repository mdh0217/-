/**
 * 백테스트 시뮬레이터 v2
 *
 * 수익성 개선 사항 (v1 → v2):
 *   1. 연속 손절 쿨다운
 *      동일 마켓 2연속 손절 → 3일간 신규 진입 차단 (추세 하락장 손실 누적 방지)
 *   2. MA 조건 완화
 *      MA5>MA20>MA60 → MA5>MA20 + open>MA60
 *      (장기 상승권 진입 유지하면서 단기 모멘텀 포착 기회 확대)
 *   3. 최소 레인지 필터
 *      전일 변동폭/전일 종가 < 0.4% → 신호 스킵 (약한 돌파 신호 제거)
 *   4. 포지션 비율 상향
 *      normal 10% → 15%, strong 20% → 25% (자본 활용률 개선)
 *   5. DCA 후 손절 강화
 *      DCA 실행 후 손절폭 축소: 3% → 2.4% (doubled position 추가 손실 제한)
 *
 * 유지된 원칙:
 *   - 룩어헤드 바이어스 방지 (today 캔들에 volume=0, close=open 패딩)
 *   - 보수적 캔들 내 순서: 손절 → 트레일링 → DCA → 신규 진입
 *   - BTC 1시간 등락률 차단
 *   - 수수료 양방향 반영 (0.05%)
 */

import { TRADING } from '../config/constants';
import {
  BacktestConfig,
  DailyBar,
  HourlyBar,
  SimPosition,
  SimulatedTrade,
  EquityPoint,
} from './types';

// ── 전략 상수 ─────────────────────────────────────────────────────────────────

const FEE_RATE           = TRADING.FEE_RATE;
const STOP_LOSS_RATE     = TRADING.STOP_LOSS_RATE;
const DCA_TRIGGER_RATE   = TRADING.DCA_TRIGGER_RATE;
const MAX_DCA_COUNT      = TRADING.MAX_DCA_COUNT;
const TRAILING_ACTIVATE  = TRADING.TRAILING_ACTIVATE_RATE;
const TRAILING_TRIGGER   = TRADING.TRAILING_TRIGGER_RATE;
const BTC_DROP_THRESHOLD = TRADING.BTC_DROP_THRESHOLD;
const DCA_STOP_FACTOR    = TRADING.DCA_STOP_FACTOR;
const MIN_ORDER_KRW      = 5_500;

// ── v2 신규 상수 (constants.ts 참조 — 실제 봇과 항상 동기화) ──────────────────

const NORMAL_POSITION_RATE = TRADING.NORMAL_POSITION_RATE;
const STRONG_POSITION_RATE = TRADING.STRONG_POSITION_RATE;
const COOLDOWN_LOSSES      = TRADING.COOLDOWN_LOSSES;
const COOLDOWN_DAYS        = TRADING.COOLDOWN_DAYS;

/**
 * 강력 신호 판단 기준:
 * 실제 봇: {거래량급증, MA정배열, 전고점돌파} 3개 중 2개 이상.
 * 백테스트: 거래량 미지 → 가용 조건 2개. 둘 다 충족 시 strong.
 */
const STRONG_COND_REQUIRED = 2;

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function getAllDaysInRange(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(`${startDate}T00:00:00+09:00`);
  const end     = new Date(`${endDate}T00:00:00+09:00`);

  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/** 'YYYY-MM-DD' 에 n일을 더한 날짜 반환 */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  d.setDate(d.getDate() + n);
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 신호 분석 ─────────────────────────────────────────────────────────────────

interface SignalResult {
  breakoutTargetPrice: number;
  signalStrength: 'strong' | 'normal';
  recommendedPositionRate: number;
}

/**
 * N일 고점 돌파 신호 분석 (v3)
 *
 * LW 변동성 돌파 → N일 고점 돌파 전환 이유:
 *   LW는 '전일 레인지 × K + 오늘 시가'로 목표가를 계산 → 자정 경계에 의존.
 *   암호화폐는 24/7 연속 시장으로 자정은 의미 없는 경계선.
 *   N일 고점은 실제 가격 레벨 기반 저항선 → 24/7에서도 유효.
 *
 * 룩어헤드 방지:
 *   nDayHigh는 dayIdx-1 이전 완성된 N개 일봉 고가의 최댓값.
 *   당일 데이터 미사용.
 *
 * 강력 신호 조건:
 *   - isMaAligned: MA5>MA20 + 시가>MA60 (단기 모멘텀 + 장기 상승권)
 *   - isLongerBreakout: N일 고점 = 2N일 고점 (더 긴 기간 고점도 동시 돌파)
 *   둘 다 충족 시 'strong', 아니면 'normal'
 */
function analyzeSignal(
  daily: DailyBar[],
  dayIdx: number,
  n: number,
  minRangeRate?: number,
): SignalResult | null {
  // MA60 계산(62일) + N일 데이터 모두 필요
  if (dayIdx < Math.max(62, n)) return null;

  const today = daily[dayIdx]!;

  // ── N일 고점 (완성 캔들 기준) ─────────────────────────────────────────────
  const nDayHigh = Math.max(
    ...daily.slice(dayIdx - n, dayIdx).map(b => b.high),
  );

  // 목표가: N일 고점
  // 시가가 이미 고점 위(갭업)라면 시가를 진입가로 사용 (비현실적 체결 방지)
  const breakoutTargetPrice = Math.max(nDayHigh, today.open);

  // 목표가가 시가 대비 15% 초과 → 당일 달성 불가, 스킵
  if ((nDayHigh - today.open) / today.open > 0.15) return null;

  // 최소 변동폭 필터: 전일 레인지가 너무 작으면 힘없는 돌파로 간주
  if (minRangeRate !== undefined && dayIdx >= 1) {
    const prev = daily[dayIdx - 1]!;
    const prevRange = (prev.high - prev.low) / prev.close;
    if (prevRange < minRangeRate) return null;
  }

  // ── MA 계산 (완성 캔들 기준) ──────────────────────────────────────────────
  const closes = daily.slice(Math.max(0, dayIdx - 60), dayIdx).map(b => b.close);
  if (closes.length < 60) return null;

  const ma5  = avg(closes.slice(-5));
  const ma20 = avg(closes.slice(-20));
  const ma60 = avg(closes);

  // MA5>MA20: 단기 상승 모멘텀 / open>MA60: 장기 상승권
  const isMaAligned = ma5 > ma20 && today.open > ma60;

  // 거래량 급증: 장 시작 전 미지 → 항상 false (보수적)
  const isVolumeSurge = false;

  // 장기 돌파 확인: N일 고점 ≈ 2N일 고점이면 더 긴 추세의 돌파 (강한 신호)
  const longerN    = Math.min(n * 2, dayIdx);
  const longHigh   = Math.max(...daily.slice(dayIdx - longerN, dayIdx).map(b => b.high));
  const isLongerBreakout = nDayHigh >= longHigh * 0.999;

  // ── 종합 판단 ─────────────────────────────────────────────────────────────
  const strongCount = [isVolumeSurge, isMaAligned, isLongerBreakout].filter(Boolean).length;

  const signalStrength: 'strong' | 'normal' =
    strongCount >= STRONG_COND_REQUIRED ? 'strong' : 'normal';

  const recommendedPositionRate =
    signalStrength === 'strong' ? STRONG_POSITION_RATE : NORMAL_POSITION_RATE;

  return { breakoutTargetPrice, signalStrength, recommendedPositionRate };
}

// ── 수수료 계산 ───────────────────────────────────────────────────────────────

function sellNet(volume: number, price: number): number {
  return volume * price * (1 - FEE_RATE);
}

// ── 마켓 상태 (쿨다운 추적) ──────────────────────────────────────────────────

interface MarketState {
  consecutiveLosses: number;
  /** '' 또는 이 날짜까지 신규 진입 차단 ('YYYY-MM-DD') */
  cooldownUntil: string;
}

// ── BacktestSimulator ─────────────────────────────────────────────────────────

export interface SimRunResult {
  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
  /** maxPositions 제한으로 스킵된 신호 수 */
  skippedByPositionCap: number;
  /** 일별 최대 동시 포지션 수 분포 { count → 일수 } */
  simultaneousPositionDist: Map<number, number>;
}

export class BacktestSimulator {
  /**
   * 시뮬레이션 실행
   *
   * @param marketDailyBars  market → 일봉 배열 (오래된 것 → 최신)
   * @param marketHourlyBars market → 60분봉 배열 (오래된 것 → 최신)
   * @param btcHourlyBars    KRW-BTC 60분봉 (BTC 하락 감지용)
   * @param config           백테스트 설정
   * @param startDate        시뮬레이션 시작일 'YYYY-MM-DD' KST
   * @param endDate          시뮬레이션 종료일 'YYYY-MM-DD' KST
   */
  run(
    marketDailyBars:  Map<string, DailyBar[]>,
    marketHourlyBars: Map<string, HourlyBar[]>,
    btcHourlyBars:    HourlyBar[],
    config:           BacktestConfig,
    startDate:        string,
    endDate:          string,
  ): SimRunResult {
    // ── config override 적용 ─────────────────────────────────────────────
    const trailingActivate = config.trailingActivateOverride ?? TRAILING_ACTIVATE;
    const trailingTrigger  = config.trailingTriggerOverride  ?? TRAILING_TRIGGER;

    // ── 사전 인덱싱 (O(n) 전처리 → O(1) 조회) ────────────────────────────

    const dailyIdxMap = new Map<string, Map<string, number>>();
    for (const [market, bars] of marketDailyBars) {
      const m = new Map<string, number>();
      bars.forEach((b, i) => m.set(b.dateKst, i));
      dailyIdxMap.set(market, m);
    }

    const hourlyByDate = new Map<string, Map<string, HourlyBar[]>>();
    for (const [market, bars] of marketHourlyBars) {
      const m = new Map<string, HourlyBar[]>();
      for (const b of bars) {
        const list = m.get(b.dateKst) ?? [];
        list.push(b);
        m.set(b.dateKst, list);
      }
      hourlyByDate.set(market, m);
    }

    // ── 시뮬레이션 상태 ───────────────────────────────────────────────────

    let krwAvailable   = config.initialCapital;
    const positions    = new Map<string, SimPosition>();
    const trades:        SimulatedTrade[] = [];
    const equityCurve:   EquityPoint[]   = [];
    const allDays      = getAllDaysInRange(startDate, endDate);
    const maxPositions = config.maxPositions ?? Infinity;

    // 포지션 상한 추적
    let skippedByPositionCap              = 0;
    const simultaneousPositionDist        = new Map<number, number>();

    // 마켓별 쿨다운 상태 (v2 신규)
    const marketStates = new Map<string, MarketState>();
    const getMS = (market: string): MarketState => {
      if (!marketStates.has(market)) {
        marketStates.set(market, { consecutiveLosses: 0, cooldownUntil: '' });
      }
      return marketStates.get(market)!;
    };

    /**
     * BTC 시간봉 포인터 (O(1) per day)
     * 포인터를 앞으로만 이동하며 "당일 시작 직전" 마지막 봉을 추적.
     */
    let btcPtr = -1;

    // ── 일별 루프 ─────────────────────────────────────────────────────────

    for (const dateKst of allDays) {

      // BTC 포인터 전진 (dateKst 이전 마지막 봉까지)
      while (
        btcPtr + 1 < btcHourlyBars.length &&
        btcHourlyBars[btcPtr + 1]!.dateKst < dateKst
      ) {
        btcPtr++;
      }
      const btcCur     = btcPtr >= 0 ? btcHourlyBars[btcPtr]     : undefined;
      const btcPrev    = btcPtr >= 1 ? btcHourlyBars[btcPtr - 1] : undefined;
      const btcBlocked = this.checkBtcDrop(
        btcCur, btcPrev,
        config.btcDropOverride,
        config.disableBtcMaBlock,
        config.markets,
        marketDailyBars,
        dateKst,
        dailyIdxMap,
      );

      // ── 마켓별 처리 ──────────────────────────────────────────────────────
      for (const market of config.markets) {
        const dailyBars  = marketDailyBars.get(market);
        const idxMap     = dailyIdxMap.get(market);
        const hourlyMap  = hourlyByDate.get(market);
        if (!dailyBars || !idxMap || !hourlyMap) continue;

        const dayIdx = idxMap.get(dateKst);
        if (dayIdx === undefined || dayIdx < 62) continue;

        const hourlyBarsToday = hourlyMap.get(dateKst) ?? [];
        if (hourlyBarsToday.length === 0) continue;

        // ── 신호 분석 ──────────────────────────────────────────────────────
        // 포지션 없고, BTC 차단 없고, 쿨다운 아닐 때만 분석
        let signal: SignalResult | null = null;
        const hasPosition = positions.has(market);
        const ms          = getMS(market);
        const inCooldown  = ms.cooldownUntil !== '' && dateKst <= ms.cooldownUntil;

        if (!hasPosition && !btcBlocked && !inCooldown) {
          const effectiveN = TRADING.MARKET_N_VALUES[market] ?? config.n;
          const s = analyzeSignal(dailyBars, dayIdx, effectiveN, config.minRangeRate);
          if (s !== null) signal = s;
        }

        // ── 시간봉 루프 ───────────────────────────────────────────────────
        // 보수적 처리 순서: 손절 → 트레일링 → DCA → 신규 진입
        for (const bar of hourlyBarsToday) {
          const pos = positions.get(market);

          if (pos !== undefined) {

            // ① 손절: 저가가 손절가 이하 ────────────────────────────────────
            if (bar.low <= pos.stopLossPrice) {
              const exitPrice = pos.stopLossPrice;
              const received  = sellNet(pos.totalVolume, exitPrice);
              const pnlKrw    = received - pos.totalInvested;
              const pnlRate   = (exitPrice - pos.avgPrice) / pos.avgPrice;

              trades.push({
                market,
                entryDatetime:  pos.entryDatetime,
                exitDatetime:   bar.datetimeKst,
                entryPrice:     pos.avgPrice,
                exitPrice,
                volume:         pos.totalVolume,
                investedKrw:    pos.totalInvested,
                pnlKrw,
                pnlRate,
                exitReason:     'stop_loss',
                dcaCount:       pos.dcaLevel,
                signalStrength: pos.signalStrength,
              });
              krwAvailable += received;
              positions.delete(market);

              // 쿨다운 카운터 증가
              const st = getMS(market);
              st.consecutiveLosses++;
              if (st.consecutiveLosses >= COOLDOWN_LOSSES) {
                st.cooldownUntil    = addDays(dateKst, COOLDOWN_DAYS);
                st.consecutiveLosses = 0;
              }

              continue;
            }

            // ② 트레일링 스탑 ────────────────────────────────────────────────
            if (!pos.trailingActive) {
              if (bar.high >= pos.avgPrice * (1 + trailingActivate)) {
                pos.trailingActive = true;
                pos.peakPrice      = bar.high;
              }
            }

            if (pos.trailingActive) {
              if (bar.high > pos.peakPrice) pos.peakPrice = bar.high;
              const triggerPrice = pos.peakPrice * (1 - trailingTrigger);

              if (bar.low <= triggerPrice) {
                const exitPrice = triggerPrice;
                const received  = sellNet(pos.totalVolume, exitPrice);
                const pnlKrw    = received - pos.totalInvested;
                const pnlRate   = (exitPrice - pos.avgPrice) / pos.avgPrice;

                trades.push({
                  market,
                  entryDatetime:  pos.entryDatetime,
                  exitDatetime:   bar.datetimeKst,
                  entryPrice:     pos.avgPrice,
                  exitPrice,
                  volume:         pos.totalVolume,
                  investedKrw:    pos.totalInvested,
                  pnlKrw,
                  pnlRate,
                  exitReason:     'trailing_stop',
                  dcaCount:       pos.dcaLevel,
                  signalStrength: pos.signalStrength,
                });
                krwAvailable += received;
                positions.delete(market);

                // 수익 청산이면 연속 손절 카운터 리셋
                if (pnlKrw > 0) {
                  getMS(market).consecutiveLosses = 0;
                }

                continue;
              }
            }

            // ③ DCA: 직전 진입가 대비 -2.5% 하락 시 추가 매수 ────────────────
            if (!config.disableDca && pos.dcaLevel < MAX_DCA_COUNT) {
              const dcaTrigger = pos.lastEntryPrice * (1 - DCA_TRIGGER_RATE);

              if (bar.low <= dcaTrigger) {
                const dcaAmount = Math.min(
                  pos.totalInvested / (pos.dcaLevel + 1),
                  krwAvailable * 0.99,
                );

                if (dcaAmount >= MIN_ORDER_KRW && krwAvailable >= dcaAmount) {
                  const dcaPrice    = dcaTrigger;
                  const dcaFee      = dcaAmount * FEE_RATE;
                  const dcaVolume   = (dcaAmount - dcaFee) / dcaPrice;
                  const newVolume   = pos.totalVolume + dcaVolume;
                  const newAvgPrice =
                    (pos.avgPrice * pos.totalVolume + dcaPrice * dcaVolume) / newVolume;

                  pos.avgPrice       = newAvgPrice;
                  pos.lastEntryPrice = dcaPrice;
                  pos.totalVolume    = newVolume;
                  pos.totalInvested += dcaAmount;
                  pos.dcaLevel++;
                  // DCA 후 손절폭 축소: doubled position 추가 손실 제한
                  pos.stopLossPrice  = newAvgPrice * (1 - STOP_LOSS_RATE * DCA_STOP_FACTOR);
                  krwAvailable      -= dcaAmount;
                }
              }
            }

          } else if (signal !== null) {
            // ④ 신규 진입 시도 ───────────────────────────────────────────────
            // 동시 포지션 상한 체크
            if (positions.size >= maxPositions) {
              skippedByPositionCap++;
              signal = null;
              continue;
            }

            const { breakoutTargetPrice, signalStrength, recommendedPositionRate } = signal;

            if (bar.high >= breakoutTargetPrice) {
              const entryPrice   = breakoutTargetPrice;
              const investAmount = Math.min(
                krwAvailable * recommendedPositionRate,
                krwAvailable * 0.99,
              );

              if (investAmount < MIN_ORDER_KRW) continue;

              const buyFee   = investAmount * FEE_RATE;
              const volume   = (investAmount - buyFee) / entryPrice;
              const stopLoss = entryPrice * (1 - STOP_LOSS_RATE);

              // 진입과 동시에 손절 트리거 (같은 캔들 저가가 손절가 이하)
              if (bar.low <= stopLoss) {
                const exitPrice = stopLoss;
                const received  = sellNet(volume, exitPrice);
                const pnlKrw    = received - investAmount;
                const pnlRate   = (exitPrice - entryPrice) / entryPrice;

                trades.push({
                  market,
                  entryDatetime:  bar.datetimeKst,
                  exitDatetime:   bar.datetimeKst,
                  entryPrice,
                  exitPrice,
                  volume,
                  investedKrw:    investAmount,
                  pnlKrw,
                  pnlRate,
                  exitReason:     'stop_loss',
                  dcaCount:       0,
                  signalStrength,
                });
                krwAvailable += received;

                const st = getMS(market);
                st.consecutiveLosses++;
                if (st.consecutiveLosses >= COOLDOWN_LOSSES) {
                  st.cooldownUntil    = addDays(dateKst, COOLDOWN_DAYS);
                  st.consecutiveLosses = 0;
                }

                signal = null;
              } else {
                // 정상 진입
                positions.set(market, {
                  market,
                  entryDatetime:  bar.datetimeKst,
                  avgPrice:       entryPrice,
                  lastEntryPrice: entryPrice,
                  totalVolume:    volume,
                  totalInvested:  investAmount,
                  dcaLevel:       0,
                  stopLossPrice:  stopLoss,
                  trailingActive: false,
                  peakPrice:      entryPrice,
                  signalStrength,
                });
                krwAvailable -= investAmount;
                signal = null; // 하루 1마켓 1회 진입
              }
            }
          }
        } // end hourly loop
      } // end market loop

      // ── 일별 자산 평가 ────────────────────────────────────────────────────
      let equity = krwAvailable;
      for (const [market, pos] of positions) {
        const lastPrice = hourlyByDate.get(market)?.get(dateKst)?.at(-1)?.close ?? pos.avgPrice;
        equity += pos.totalVolume * lastPrice;
      }
      equityCurve.push({ dateKst, equity });

      // 일별 동시 포지션 수 분포 기록
      const cnt = positions.size;
      simultaneousPositionDist.set(cnt, (simultaneousPositionDist.get(cnt) ?? 0) + 1);

    } // end day loop

    // ── 종료 시 미청산 포지션 강제 청산 ──────────────────────────────────────
    for (const [market, pos] of positions) {
      const lastHourly = marketHourlyBars.get(market)?.at(-1);
      const exitPrice  = lastHourly?.close ?? pos.avgPrice;
      const received   = sellNet(pos.totalVolume, exitPrice);
      const pnlKrw     = received - pos.totalInvested;
      const pnlRate    = (exitPrice - pos.avgPrice) / pos.avgPrice;

      trades.push({
        market,
        entryDatetime:  pos.entryDatetime,
        exitDatetime:   lastHourly?.datetimeKst ?? endDate + 'T23:00:00',
        entryPrice:     pos.avgPrice,
        exitPrice,
        volume:         pos.totalVolume,
        investedKrw:    pos.totalInvested,
        pnlKrw,
        pnlRate,
        exitReason:     'end_of_data',
        dcaCount:       pos.dcaLevel,
        signalStrength: pos.signalStrength,
      });
      krwAvailable += received;
    }

    return { trades, equityCurve, skippedByPositionCap, simultaneousPositionDist };
  }

  // ── BTC 하락 감지 ─────────────────────────────────────────────────────────

  private checkBtcDrop(
    cur:              HourlyBar | undefined,
    prev:             HourlyBar | undefined,
    dropOverride?:    number,
    disableMaBlock?:  boolean,
    markets?:         string[],
    marketDailyBars?: Map<string, DailyBar[]>,
    dateKst?:         string,
    dailyIdxMap?:     Map<string, Map<string, number>>,
  ): boolean {
    if (!cur || !prev) return false;

    const threshold = dropOverride ?? BTC_DROP_THRESHOLD;
    if ((cur.close - prev.close) / prev.close < threshold) return true;

    // MA 역배열 차단 (옵션으로 비활성화 가능)
    if (!disableMaBlock && markets && marketDailyBars && dateKst && dailyIdxMap) {
      const btcBars = marketDailyBars.get('KRW-BTC');
      const btcIdx  = dailyIdxMap.get('KRW-BTC')?.get(dateKst);
      if (btcBars && btcIdx !== undefined && btcIdx >= 20) {
        const closes = btcBars.slice(btcIdx - 20, btcIdx).map(b => b.close);
        const ma5  = closes.slice(-5).reduce((s, v) => s + v, 0) / 5;
        const ma20 = closes.reduce((s, v) => s + v, 0) / closes.length;
        if (ma5 < ma20) return true;
      }
    }

    return false;
  }
}
