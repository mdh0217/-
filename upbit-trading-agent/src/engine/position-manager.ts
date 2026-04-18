/**
 * 포지션 리스크 판단 (순수 로직 — I/O 없음)
 *
 * 손절:   평단가 대비 -3% 도달 시 즉시 전량 손절
 * DCA:    직전 진입가 대비 -1.5% 하락 시 추가 매수 (최대 2회 추가, 총 3회)
 * 익절:   +2% 달성 시 트레일링 스탑 활성화 → 고점 대비 -0.5% 하락 시 익절 확정
 */

import { Position } from '../types/index';
import { TRADING } from '../config/constants';
import { fmt, krw } from '../utils/format';

const STOP_LOSS_RATE         = TRADING.STOP_LOSS_RATE;
const DCA_TRIGGER_RATE       = TRADING.DCA_TRIGGER_RATE;
const MAX_DCA_COUNT          = TRADING.MAX_DCA_COUNT;
const TRAILING_ACTIVATE_RATE = TRADING.TRAILING_ACTIVATE_RATE;
const TRAILING_TRIGGER_RATE  = TRADING.TRAILING_TRIGGER_RATE;

// ── 손절 ─────────────────────────────────────────────────────────────────────

export function checkStopLoss(position: Position, currentPrice: number): boolean {
  return currentPrice <= position.stop_loss_price;
}

/** 현재 손익률 (unrealized) */
export function calcUnrealizedPnlRate(position: Position, currentPrice: number): number {
  return (currentPrice - position.avg_price) / position.avg_price;
}

// ── 트레일링 스탑 ─────────────────────────────────────────────────────────────

export interface TrailingResult {
  triggered: boolean;
  trailingActive: boolean;
  newPeak: number;
}

export function evalTrailingStop(position: Position, currentPrice: number): TrailingResult {
  const activationPrice = position.avg_price * (1 + TRAILING_ACTIVATE_RATE);

  let trailingActive = position.trailing_active;
  let newPeak = position.peak_price ?? currentPrice;

  // 활성화 조건 체크
  if (!trailingActive && currentPrice >= activationPrice) {
    trailingActive = true;
    newPeak = currentPrice;
  }

  if (!trailingActive) {
    return { triggered: false, trailingActive: false, newPeak };
  }

  // 고점 갱신
  if (currentPrice > newPeak) newPeak = currentPrice;

  // 익절 트리거: 고점 대비 -0.5%
  const triggerPrice = newPeak * (1 - TRAILING_TRIGGER_RATE);
  if (currentPrice <= triggerPrice) {
    return { triggered: true, trailingActive: true, newPeak };
  }

  return { triggered: false, trailingActive: true, newPeak };
}

// ── 분할 매수 ─────────────────────────────────────────────────────────────────

export function shouldDCA(position: Position, currentPrice: number): boolean {
  if (position.dca_level >= MAX_DCA_COUNT) return false;

  const lastEntry = position.entries[position.entries.length - 1];
  if (!lastEntry) return false;

  const dcaTriggerPrice = lastEntry.price * (1 - DCA_TRIGGER_RATE);
  return currentPrice <= dcaTriggerPrice;
}

export function dcaTriggerPrice(position: Position): number {
  const lastEntry = position.entries[position.entries.length - 1];
  if (!lastEntry) return 0;
  return lastEntry.price * (1 - DCA_TRIGGER_RATE);
}

// ── 포지션 요약 텍스트 ────────────────────────────────────────────────────────

export function positionSummaryLines(position: Position, currentPrice: number): string[] {
  const pnlRate = calcUnrealizedPnlRate(position, currentPrice) * 100;
  const pnlKrw  = (currentPrice - position.avg_price) * position.total_volume;
  const sign    = pnlRate >= 0 ? '+' : '';

  const lines = [
    `  마켓:     ${position.market}`,
    `  평단가:   ${fmt(position.avg_price)}  |  현재가: ${fmt(currentPrice)}`,
    `  미실현:   ${sign}${pnlRate.toFixed(2)}%  (${sign}${krw(pnlKrw)})`,
    `  손절가:   ${fmt(position.stop_loss_price)}  (평단 대비 -${(STOP_LOSS_RATE * 100).toFixed(1)}%)`,
    `  DCA:      ${position.dca_level}/${MAX_DCA_COUNT}회 완료`,
  ];

  if (position.trailing_active) {
    const peak   = position.peak_price ?? currentPrice;
    const trigger = peak * (1 - TRAILING_TRIGGER_RATE);
    lines.push(`  트레일링: 활성 ✓  고점 ${fmt(peak)}  익절선 ${fmt(trigger)}`);
  } else {
    const activationPrice = position.avg_price * (1 + TRAILING_ACTIVATE_RATE);
    lines.push(
      `  트레일링: 대기 중  활성가 ${fmt(activationPrice)} (+${(TRAILING_ACTIVATE_RATE * 100).toFixed(0)}%)`,
    );
  }

  if (position.dca_level < MAX_DCA_COUNT) {
    const nextDca = dcaTriggerPrice(position);
    lines.push(`  다음 DCA: ${fmt(nextDca)} 도달 시 ${position.dca_level + 2}차 매수`);
  }

  return lines;
}

export { MAX_DCA_COUNT, STOP_LOSS_RATE, TRAILING_ACTIVATE_RATE, TRAILING_TRIGGER_RATE };
