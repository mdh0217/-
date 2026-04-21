/**
 * 백테스트 결과 리포터
 */

import * as fs   from 'fs';
import * as path from 'path';
import { BacktestMetrics, PerMarketMetrics, SimulatedTrade } from './types';
import { ANSI } from '../utils/color';

const R = ANSI.reset;

function colorPct(n: number): string {
  const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  return n >= 0 ? `${ANSI.green}${s}${R}` : `${ANSI.red}${s}${R}`;
}

function colorNum(n: number, suffix = ''): string {
  const s = (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('ko-KR') + suffix;
  return n >= 0 ? `${ANSI.green}${s}${R}` : `${ANSI.red}${s}${R}`;
}

function line(char = '─', len = 60): string {
  return char.repeat(len);
}

function fmtHours(h: number): string {
  if (h < 1)   return `${Math.round(h * 60)}분`;
  if (h < 24)  return `${h.toFixed(1)}시간`;
  return `${(h / 24).toFixed(1)}일`;
}

function fmtPF(pf: number): string {
  if (!isFinite(pf)) return `${ANSI.green}∞${R}`;
  const s = pf.toFixed(2);
  return pf >= 1.5
    ? `${ANSI.green}${s}${R}`
    : pf >= 1.0
      ? `${ANSI.bold}${s}${R}`
      : `${ANSI.red}${s}${R}`;
}

// ── 단일 결과 출력 ────────────────────────────────────────────────────────────

export function printMetrics(m: BacktestMetrics, label?: string): void {
  const periodLabel = label ?? (m.period === 'train' ? '학습 기간' : '검증 기간 (Out-of-Sample)');
  const periodColor = m.period === 'train' ? ANSI.cyan : ANSI.yellow;

  console.log(`\n${line()}`);
  console.log(`${ANSI.bold}${periodColor}  ${periodLabel}${R}`);
  console.log(`  기간: ${m.startDate} ~ ${m.endDate}  |  N = ${m.n}일`);
  console.log(`  마켓: ${m.markets.join(', ')}`);
  console.log(line());

  // 수익 요약
  const delta = m.finalCapital - m.initialCapital;
  console.log(`  초기 자본:    ${m.initialCapital.toLocaleString('ko-KR')}원`);
  console.log(`  최종 자본:    ${m.finalCapital.toLocaleString('ko-KR')}원`);
  console.log(`  손익:         ${colorNum(delta, '원')} (${colorPct(m.totalReturnPct)})`);
  console.log(`  최대 낙폭:    ${ANSI.red}${m.maxDrawdownPct.toFixed(2)}%${R}`);
  console.log(`  샤프 지수:    ${ANSI.bold}${m.sharpeRatio.toFixed(2)}${R}`);

  console.log(line('·'));

  // 확장 지표
  console.log(`  프로핏 팩터:  ${fmtPF(m.profitFactor)}`);
  console.log(`  칼마 비율:    ${m.calmarRatio.toFixed(2)}`);
  console.log(`  평균 보유:    ${fmtHours(m.avgHoldingHours)}`);
  console.log(`  노출 비율:    ${m.marketExposurePct.toFixed(1)}%`);

  console.log(line('·'));

  // 거래 통계
  console.log(`  총 거래:      ${m.tradeCount}회`);
  if (m.tradeCount > 0) {
    console.log(`    승률:       ${m.winCount}승 ${m.lossCount}패  (${m.winRate.toFixed(1)}%)`);
    console.log(`    평균 수익:  ${colorPct(m.avgWinPct)}`);
    console.log(`    평균 손실:  ${colorPct(m.avgLossPct)}`);

    // 청산 사유 분포
    const reasons = countExitReasons(m.trades);
    console.log(`    손절:       ${reasons.stop_loss}회`);
    console.log(`    트레일링:   ${reasons.trailing_stop}회`);
    if (reasons.end_of_data > 0) {
      console.log(`    강제청산:   ${reasons.end_of_data}회`);
    }
  }
  console.log(line());
}

// ── 마켓별 성과 출력 ──────────────────────────────────────────────────────────

export function printPerMarketBreakdown(perMarket: PerMarketMetrics[]): void {
  if (perMarket.length === 0) return;

  console.log(`\n${ANSI.bold}  마켓별 성과${R}`);
  console.log(line('·'));
  console.log('  마켓         거래  승률       손익(KRW)         평균수익   평균손실');
  console.log(line('·'));

  for (const pm of perMarket) {
    const pnl   = colorNum(pm.totalPnlKrw, '원');
    const wr    = `${pm.winCount}승${pm.lossCount}패(${pm.winRate.toFixed(0)}%)`;
    const avgW  = colorPct(pm.avgWinPct);
    const avgL  = colorPct(pm.avgLossPct);
    console.log(
      `  ${pm.market.padEnd(12)}` +
      `  ${String(pm.tradeCount).padStart(3)}회` +
      `  ${wr.padEnd(14)}` +
      `  ${pnl.padEnd(26)}` +
      `  ${avgW.padEnd(20)}` +
      `  ${avgL}`,
    );
  }
  console.log(line('·'));
}

// ── K 스캔 요약 출력 ──────────────────────────────────────────────────────────

export function printScanSummary(
  scanResults: Array<{ n: number; sharpe: number; returnPct: number }>,
  bestN: number,
): void {
  console.log(`\n${line()}`);
  console.log(`${ANSI.bold}${ANSI.cyan}  N값 스캔 결과 (학습 기간)${R}`);
  console.log(line());
  console.log('  N일    수익률      샤프    선택');
  console.log(line('·'));

  for (const r of scanResults) {
    const marker = r.n === bestN ? `${ANSI.bold}${ANSI.yellow} ← 최적${R}` : '';
    const ret    = colorPct(r.returnPct);
    const sharpe = r.sharpe >= 1.0
      ? `${ANSI.green}${r.sharpe.toFixed(2)}${R}`
      : `${ANSI.gray}${r.sharpe.toFixed(2)}${R}`;
    console.log(`  ${String(r.n).padStart(2)}일   ${ret.padEnd(20)}  ${sharpe}${marker}`);
  }
  console.log(line());
}

// ── 주요 거래 목록 출력 (수익 상위 3건 + 손실 하위 2건) ──────────────────────

export function printTopTrades(trades: SimulatedTrade[], label = '주요 거래'): void {
  if (trades.length === 0) return;

  const byRate  = [...trades].sort((a, b) => b.pnlRate - a.pnlRate);
  const topWins = byRate.slice(0, 3);
  const topLoss = byRate.slice(-2).reverse();
  const toShow  = [...topWins, ...topLoss];

  console.log(`\n${ANSI.bold}  ${label} (수익 상위 3건 + 손실 하위 2건)${R}`);
  console.log(line('·'));

  for (const t of toShow) {
    const sign   = t.pnlKrw >= 0 ? ANSI.green : ANSI.red;
    const reason = { stop_loss: '손절', trailing_stop: '익절', end_of_data: '강제' }[t.exitReason];
    console.log(
      `  ${t.market.padEnd(10)}` +
      `  ${t.entryDatetime.slice(0, 13)} → ${t.exitDatetime.slice(0, 13)}` +
      `  ${sign}${t.pnlRate >= 0 ? '+' : ''}${(t.pnlRate * 100).toFixed(2)}%${R}` +
      `  [${reason}]`,
    );
  }
  console.log(line('·'));
}

// ── CSV 내보내기 ──────────────────────────────────────────────────────────────

export function exportCsv(m: BacktestMetrics): void {
  const dir = path.resolve(process.cwd(), 'data', 'backtest-results');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 파일명: backtest_YYYY-MM-DD_HHmmss_<period>.csv
  const now    = new Date();
  const stamp  =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}_` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`;
  const fname  = `backtest_${stamp}_${m.period}.csv`;
  const fpath  = path.join(dir, fname);

  const header = [
    'market', 'entryDatetime', 'exitDatetime',
    'entryPrice', 'exitPrice', 'volume',
    'investedKrw', 'pnlKrw', 'pnlRatePct',
    'exitReason', 'dcaCount', 'signalStrength',
  ].join(',');

  const rows = m.trades.map(t => [
    t.market,
    t.entryDatetime,
    t.exitDatetime,
    t.entryPrice.toFixed(2),
    t.exitPrice.toFixed(2),
    t.volume.toFixed(8),
    Math.round(t.investedKrw),
    Math.round(t.pnlKrw),
    (t.pnlRate * 100).toFixed(4),
    t.exitReason,
    t.dcaCount,
    t.signalStrength,
  ].join(','));

  fs.writeFileSync(fpath, [header, ...rows].join('\n'), 'utf-8');
  console.log(`  CSV 저장: ${fpath}`);
}

// ── 경고 메시지 ───────────────────────────────────────────────────────────────

export function printWarnings(m: BacktestMetrics): void {
  const warnings: string[] = [];

  if (m.tradeCount < 10) {
    warnings.push('거래 횟수가 적어 통계적 신뢰도가 낮습니다. 테스트 기간을 늘려주세요.');
  }
  if (m.maxDrawdownPct > 20) {
    warnings.push(`MDD ${m.maxDrawdownPct.toFixed(1)}% — 실거래 적용 전 리스크 재검토를 권장합니다.`);
  }
  if (m.sharpeRatio < 0.5) {
    warnings.push('샤프 지수가 낮습니다 (기준: 1.0 이상). 전략 파라미터를 재검토하세요.');
  }
  if (isFinite(m.profitFactor) && m.profitFactor < 1.0) {
    warnings.push(`프로핏 팩터 ${m.profitFactor.toFixed(2)} — 손실이 이익을 초과합니다.`);
  }

  if (warnings.length > 0) {
    console.log(`\n${ANSI.yellow}${ANSI.bold}  ⚠ 주의사항${R}`);
    for (const w of warnings) {
      console.log(`  · ${w}`);
    }
  }
}

// ── 신호 강도별 성과 분석 ─────────────────────────────────────────────────────

export function printSignalStrengthBreakdown(trades: SimulatedTrade[]): void {
  if (trades.length === 0) return;

  const groups = { strong: [] as SimulatedTrade[], normal: [] as SimulatedTrade[] };
  for (const t of trades) groups[t.signalStrength].push(t);

  const summarize = (ts: SimulatedTrade[]) => {
    if (ts.length === 0) return null;
    const wins   = ts.filter(t => t.pnlKrw > 0);
    const losses = ts.filter(t => t.pnlKrw <= 0);
    const winPct = (wins.length / ts.length) * 100;
    const avgWin = wins.length  > 0 ? wins.reduce((s, t) => s + t.pnlRate, 0) / wins.length * 100   : 0;
    const avgLos = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlRate, 0) / losses.length * 100 : 0;
    const totalPnl = ts.reduce((s, t) => s + t.pnlKrw, 0);
    const grossWin = wins.reduce((s, t) => s + t.pnlKrw, 0);
    const grossLos = Math.abs(losses.reduce((s, t) => s + t.pnlKrw, 0));
    const pf = grossLos > 0 ? grossWin / grossLos : Infinity;
    return { count: ts.length, winPct, avgWin, avgLos, totalPnl, pf };
  };

  const s = summarize(groups.strong);
  const n = summarize(groups.normal);

  console.log(`\n${ANSI.bold}  신호 강도별 성과 분석${R}`);
  console.log(line('·'));
  console.log('  구분      거래   승률      평균수익   평균손실   PF         총손익(KRW)');
  console.log(line('·'));

  const row = (label: string, d: ReturnType<typeof summarize>) => {
    if (!d) { console.log(`  ${label.padEnd(8)}  (데이터 없음)`); return; }
    const wr   = `${d.winPct.toFixed(1)}%`.padStart(6);
    const aw   = colorPct(d.avgWin);
    const al   = colorPct(d.avgLos);
    const pf   = fmtPF(d.pf);
    const pnl  = colorNum(d.totalPnl, '원');
    console.log(
      `  ${label.padEnd(8)}` +
      `  ${String(d.count).padStart(3)}회` +
      `  ${wr}` +
      `  ${aw.padEnd(20)}` +
      `  ${al.padEnd(20)}` +
      `  ${pf.padEnd(16)}` +
      `  ${pnl}`,
    );
  };

  row('강력(S)', s);
  row('보통(N)', n);
  console.log(line('·'));

  // 결론 메시지
  if (s && n) {
    const winDiff = s.winPct - n.winPct;
    const icon = winDiff > 0 ? ANSI.green : ANSI.red;
    console.log(
      `  강력 신호 승률 차이: ${icon}${winDiff >= 0 ? '+' : ''}${winDiff.toFixed(1)}%${R}` +
      `  PF 차이: ${fmtPF(s.pf)} vs ${fmtPF(n.pf)}`,
    );
  }
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function countExitReasons(trades: SimulatedTrade[]): Record<SimulatedTrade['exitReason'], number> {
  return trades.reduce(
    (acc, t) => { acc[t.exitReason]++; return acc; },
    { stop_loss: 0, trailing_stop: 0, end_of_data: 0 },
  );
}
