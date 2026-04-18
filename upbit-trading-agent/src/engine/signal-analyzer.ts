/**
 * 신호 분석기 — N일 고점 돌파 (Turtle Trading)
 *
 * 전략:
 *   진입 조건:  현재가 ≥ 과거 N일 최고가 (= N일 고점 돌파)
 *   보조 조건:
 *     - 이평선 정배열: 5MA > 20MA, 시가 > 60MA
 *     - 더 긴 기간 돌파: N일 고점 ≈ 2N일 고점 (대형 추세 돌파 확인)
 *
 * 강력 신호 (strong):  진입 조건 + 보조 조건 2개 모두 충족 → 비중 25%
 * 일반 신호 (normal):  진입 조건만 충족                       → 비중 15%
 * 신호 없음 (none):    진입 조건 미충족                       → HOLD
 */

import { UpbitCandle, SignalAnalysis } from '../types/index';
import { env } from '../config/env';
import { TRADING } from '../config/constants';
import { fmt } from '../utils/format';
import { logger } from '../utils/logger';

// N일 고점과 2N일 고점이 얼마나 비슷할 때 '대형 추세 돌파'로 인정할지 허용 오차
const LONGER_BREAKOUT_TOLERANCE = 0.999; // 0.1% 이내면 동일 수준 돌파로 판단

export class SignalAnalyzer {
  analyze(
    market: string,
    candles: UpbitCandle[],
    currentPrice: number,
    overrideN?: number,
  ): SignalAnalysis {
    const n = overrideN ?? env.nDayPeriod;

    // 최소 필요 캔들: max(2N + 2, 62) — 2N일 고점 + 60MA
    const minRequired = Math.max(n * 2 + 2, 62);
    if (candles.length < minRequired) {
      return this.noSignal(market, currentPrice, n, `캔들 부족 (${candles.length}/${minRequired})`);
    }

    // 오름차순 정렬 (오래된 것 → 최신)
    const sorted = [...candles].sort(
      (a, b) =>
        new Date(a.candle_date_time_utc).getTime() -
        new Date(b.candle_date_time_utc).getTime(),
    );

    const today = sorted[sorted.length - 1]!

    // ── 0. 데이터 신선도 검증 ─────────────────────────────────────────────────
    // 일봉 기준 마지막 캔들이 36시간 이상 지났으면 데이터 지연으로 판단
    const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;
    const latestCandleAge = Date.now() - new Date(today.candle_date_time_utc).getTime();
    if (latestCandleAge > STALE_THRESHOLD_MS) {
      logger.warn(
        `[신선도] ${market} 캔들 데이터 오래됨 — 마지막 캔들: ${today.candle_date_time_utc} (${Math.round(latestCandleAge / 3_600_000)}시간 전)`,
      );
      return this.noSignal(market, currentPrice, n, `캔들 데이터 오래됨 (마지막: ${today.candle_date_time_utc})`);
    };

    // ── 1. N일 고점 돌파 ──────────────────────────────────────────────────────
    // 오늘을 제외한 과거 N개 캔들의 최고가
    const nDaySlice  = sorted.slice(-n - 1, -1);
    const nDayHigh   = Math.max(...nDaySlice.map(c => c.high_price));

    // 극단적 갭상승 방지: 오늘 시가 대비 15% 이상 고점이 높으면 유효하지 않은 신호
    if ((nDayHigh - today.opening_price) / today.opening_price > 0.15) {
      return this.noSignal(market, currentPrice, n, `N일 고점이 시가 대비 15% 초과 — 갭 필터 적용`);
    }

    // 돌파 목표가: nDayHigh와 오늘 시가 중 큰 값
    const breakoutTargetPrice = Math.max(nDayHigh, today.opening_price);
    const isNDayHighBreakout  = currentPrice >= breakoutTargetPrice;

    // ── 2. 이평선 정배열 ──────────────────────────────────────────────────────
    const closes = sorted.map(c => c.trade_price);
    const ma5    = calcMA(closes, 5);
    const ma20   = calcMA(closes, 20);
    const ma60   = calcMA(closes, 60);
    const isMaAligned = ma5 > ma20 && today.opening_price > ma60;

    // ── 3. 더 긴 기간 돌파 (2N일 고점) ───────────────────────────────────────
    const longSlice   = sorted.slice(-n * 2 - 1, -1);
    const longHigh    = Math.max(...longSlice.map(c => c.high_price));
    const isLongerBreakout = nDayHigh >= longHigh * LONGER_BREAKOUT_TOLERANCE;

    // ── 4. 거래량 급증 (보조 정보, 신호 판단에는 미사용) ─────────────────────
    const volumes    = sorted.slice(-21, -1).map(c => c.candle_acc_trade_volume);
    const avgVolume  = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    const volumeRatio = today.candle_acc_trade_volume / avgVolume;
    const isVolumeSurge = false; // 일봉 장중 캔들은 아직 완성 전 — 참고용만 표시

    // ── 종합 판단 ─────────────────────────────────────────────────────────────
    const strongConditionCount = [isMaAligned, isLongerBreakout].filter(Boolean).length;

    let signalStrength: SignalAnalysis['signalStrength'];
    if (!isNDayHighBreakout) {
      signalStrength = 'none';
    } else if (strongConditionCount >= 2) {
      signalStrength = 'strong';
    } else {
      signalStrength = 'normal';
    }

    const recommendedPositionRate =
      signalStrength === 'strong' ? TRADING.STRONG_POSITION_RATE :
      signalStrength === 'normal' ? TRADING.NORMAL_POSITION_RATE : 0;

    // ── 판단 근거 문장 생성 ───────────────────────────────────────────────────
    const reasons: string[] = [];
    if (isNDayHighBreakout) {
      reasons.push(
        `${n}일 고점 돌파 (현재가 ${fmt(currentPrice)} ≥ 목표가 ${fmt(breakoutTargetPrice)})`,
      );
    }
    if (isMaAligned) {
      reasons.push(`이평선 정배열 5MA(${ma5.toFixed(0)}) > 20MA(${ma20.toFixed(0)}), 시가 > 60MA`);
    }
    if (isLongerBreakout) {
      reasons.push(`${n * 2}일 고점도 동시 돌파 (대형 추세 확인)`);
    }
    if (volumeRatio >= 1.25) {
      reasons.push(`거래량 급증 ${(volumeRatio * 100).toFixed(0)}%`);
    }

    return {
      market,
      timestamp: Date.now(),
      currentPrice,
      isNDayHighBreakout,
      breakoutTargetPrice,
      nDayHigh,
      n,
      isVolumeSurge,
      volumeRatio,
      avgVolume,
      isMaAligned,
      ma5,
      ma20,
      ma60,
      isLongerBreakout,
      strongConditionCount,
      signalStrength,
      recommendedPositionRate,
      reasons,
    };
  }

  private noSignal(
    market: string,
    currentPrice: number,
    n: number,
    _reason: string,
  ): SignalAnalysis {
    return {
      market,
      timestamp: Date.now(),
      currentPrice,
      isNDayHighBreakout: false,
      breakoutTargetPrice: 0,
      nDayHigh: 0,
      n,
      isVolumeSurge: false,
      volumeRatio: 0,
      avgVolume: 0,
      isMaAligned: false,
      ma5: 0,
      ma20: 0,
      ma60: 0,
      isLongerBreakout: false,
      strongConditionCount: 0,
      signalStrength: 'none',
      recommendedPositionRate: 0,
      reasons: [_reason],
    };
  }
}

// ── 내부 유틸 ──────────────────────────────────────────────────────────────────

function calcMA(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}
