/**
 * N값 최적화 모듈
 *
 * 오버피팅 방지:
 *   - 전체 기간을 train(70%) / test(30%) 로 분리
 *   - train 기간에서 Sharpe Ratio 기준으로 최적 N 선택
 *   - 선택된 N을 out-of-sample test 기간에 적용해 실질 성능 검증
 */

import { BacktestConfig, BacktestMetrics, DailyBar, HourlyBar, PerMarketMetrics, SimulatedTrade, EquityPoint } from './types';
import { BacktestSimulator } from './simulator';

// ── N 탐색 범위 ───────────────────────────────────────────────────────────────
// 터틀 트레이딩 참고값: System1=20일, System2=55일
// 단기(10~15): 빠른 반응, 노이즈 많음
// 중기(20~30): 표준 설정
// 장기(40~55): 느린 반응, 대형 추세 포착

const N_VALUES = [10, 15, 20, 25, 30, 40, 55];

// ── 지표 계산 ─────────────────────────────────────────────────────────────────

export function calcMetrics(
  n:              number,
  markets:        string[],
  period:         'train' | 'test',
  startDate:      string,
  endDate:        string,
  initialCapital: number,
  trades:         SimulatedTrade[],
  equityCurve:    EquityPoint[],
): BacktestMetrics {
  const finalCapital   = equityCurve.at(-1)?.equity ?? initialCapital;
  const totalReturnPct = (finalCapital - initialCapital) / initialCapital * 100;

  const winTrades  = trades.filter(t => t.pnlKrw > 0);
  const lossTrades = trades.filter(t => t.pnlKrw <= 0);

  const winRate    = trades.length > 0 ? winTrades.length / trades.length * 100 : 0;
  const avgWinPct  = winTrades.length > 0
    ? winTrades.reduce((s, t) => s + t.pnlRate, 0) / winTrades.length * 100
    : 0;
  const avgLossPct = lossTrades.length > 0
    ? lossTrades.reduce((s, t) => s + t.pnlRate, 0) / lossTrades.length * 100
    : 0;

  // 최대 낙폭 (MDD)
  let peak           = initialCapital;
  let maxDrawdownPct = 0;
  for (const { equity } of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  // 연환산 샤프 지수 (일별 수익률 기준, 무위험 이자율 0% 가정)
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const curr = equityCurve[i]!.equity;
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }

  let sharpeRatio = 0;
  if (dailyReturns.length > 1) {
    const meanR    = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / dailyReturns.length;
    const stdDev   = Math.sqrt(variance);
    sharpeRatio    = stdDev > 0 ? (meanR / stdDev) * Math.sqrt(365) : 0;
  }

  // 프로핏 팩터 (총이익 / 총손실)
  const grossProfit  = winTrades.reduce((s, t) => s + t.pnlKrw, 0);
  const grossLoss    = Math.abs(lossTrades.reduce((s, t) => s + t.pnlKrw, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // 칼마 비율 (연환산 수익률 / MDD)
  const testDays     = equityCurve.length > 0 ? equityCurve.length : 1;
  const annualRetPct = totalReturnPct / testDays * 365;
  const calmarRatio  = maxDrawdownPct > 0 ? annualRetPct / maxDrawdownPct : 0;

  // 평균 보유 시간 (시간 단위)
  let totalHoldMs = 0;
  for (const t of trades) {
    totalHoldMs += new Date(t.exitDatetime).getTime() - new Date(t.entryDatetime).getTime();
  }
  const avgHoldingHours = trades.length > 0 ? totalHoldMs / trades.length / 3_600_000 : 0;

  // 노출 비율 (총 포지션 보유 시간 / 전체 테스트 시간)
  const totalExposureHours = totalHoldMs / 3_600_000;
  const totalTestHours     = testDays * 24;
  const marketExposurePct  = totalTestHours > 0 ? totalExposureHours / totalTestHours * 100 : 0;

  // 마켓별 성과 집계
  const marketMap = new Map<string, SimulatedTrade[]>();
  for (const t of trades) {
    const arr = marketMap.get(t.market) ?? [];
    arr.push(t);
    marketMap.set(t.market, arr);
  }

  const perMarket: PerMarketMetrics[] = [...marketMap.entries()].map(([market, mTrades]) => {
    const mWins   = mTrades.filter(t => t.pnlKrw > 0);
    const mLosses = mTrades.filter(t => t.pnlKrw <= 0);
    return {
      market,
      tradeCount:  mTrades.length,
      winCount:    mWins.length,
      lossCount:   mLosses.length,
      winRate:     mTrades.length > 0 ? mWins.length / mTrades.length * 100 : 0,
      totalPnlKrw: mTrades.reduce((s, t) => s + t.pnlKrw, 0),
      avgWinPct:   mWins.length > 0
        ? mWins.reduce((s, t) => s + t.pnlRate, 0) / mWins.length * 100 : 0,
      avgLossPct:  mLosses.length > 0
        ? mLosses.reduce((s, t) => s + t.pnlRate, 0) / mLosses.length * 100 : 0,
    };
  });

  return {
    n,
    markets,
    period,
    startDate,
    endDate,
    initialCapital,
    finalCapital,
    totalReturnPct,
    tradeCount:    trades.length,
    winCount:      winTrades.length,
    lossCount:     lossTrades.length,
    winRate,
    avgWinPct,
    avgLossPct,
    maxDrawdownPct,
    sharpeRatio,
    profitFactor,
    calmarRatio,
    avgHoldingHours,
    marketExposurePct,
    perMarket,
    trades,
    equityCurve,
  };
}

// ── BacktestOptimizer ─────────────────────────────────────────────────────────

export interface OptimizeResult {
  bestN:        number;
  trainMetrics: BacktestMetrics;
  testMetrics:  BacktestMetrics;
  scanResults:  Array<{ n: number; sharpe: number; returnPct: number }>;
}

export class BacktestOptimizer {
  private readonly simulator: BacktestSimulator;

  constructor() {
    this.simulator = new BacktestSimulator();
  }

  optimize(
    marketDailyBars:  Map<string, DailyBar[]>,
    marketHourlyBars: Map<string, HourlyBar[]>,
    btcHourlyBars:    HourlyBar[],
    config:           BacktestConfig,
    allDays:          string[],
  ): OptimizeResult {
    // ── 학습/검증 기간 분리 ──────────────────────────────────────────────
    const splitIdx  = Math.floor(allDays.length * config.trainRatio);
    const trainDays = allDays.slice(0, splitIdx);
    const testDays  = allDays.slice(splitIdx);

    if (trainDays.length === 0 || testDays.length === 0) {
      throw new Error('[Optimizer] 학습 또는 검증 기간이 비어 있습니다. days를 늘려주세요.');
    }

    const trainStart = trainDays[0]!;
    const trainEnd   = trainDays[trainDays.length - 1]!;
    const testStart  = testDays[0]!;
    const testEnd    = testDays[testDays.length - 1]!;

    // ── N 스캔 (학습 기간 기준) ──────────────────────────────────────────
    const scanResults: OptimizeResult['scanResults'] = [];
    let bestN      = N_VALUES[2]!;  // 기본값 20
    let bestSharpe = -Infinity;

    process.stdout.write('\n[최적화] N값 스캔 중...\n');

    for (const n of N_VALUES) {
      const { trades, equityCurve } = this.simulator.run(
        marketDailyBars,
        marketHourlyBars,
        btcHourlyBars,
        { ...config, n },
        trainStart,
        trainEnd,
      );

      const metrics = calcMetrics(
        n, config.markets, 'train',
        trainStart, trainEnd,
        config.initialCapital, trades, equityCurve,
      );

      scanResults.push({ n, sharpe: metrics.sharpeRatio, returnPct: metrics.totalReturnPct });

      process.stdout.write(
        `  N=${String(n).padStart(2)}  수익률=${metrics.totalReturnPct.toFixed(1).padStart(6)}%` +
        `  샤프=${metrics.sharpeRatio.toFixed(2).padStart(5)}` +
        `  거래=${String(metrics.tradeCount).padStart(3)}회\n`,
      );

      // 샤프 우선, 동점 시 수익률
      if (
        metrics.sharpeRatio > bestSharpe ||
        (metrics.sharpeRatio === bestSharpe &&
          metrics.totalReturnPct > (scanResults.find(r => r.n === bestN)?.returnPct ?? 0))
      ) {
        bestSharpe = metrics.sharpeRatio;
        bestN      = n;
      }
    }

    process.stdout.write(`\n[최적화] 최적 N = ${bestN}일 (샤프 ${bestSharpe.toFixed(2)})\n`);

    // ── 최적 N으로 학습 기간 최종 실행 ──────────────────────────────────
    const { trades: trainTrades, equityCurve: trainCurve } = this.simulator.run(
      marketDailyBars, marketHourlyBars, btcHourlyBars,
      { ...config, n: bestN }, trainStart, trainEnd,
    );
    const trainMetrics = calcMetrics(
      bestN, config.markets, 'train',
      trainStart, trainEnd,
      config.initialCapital, trainTrades, trainCurve,
    );

    // ── 최적 N으로 검증 기간 실행 (out-of-sample) ────────────────────────
    const { trades: testTrades, equityCurve: testCurve } = this.simulator.run(
      marketDailyBars, marketHourlyBars, btcHourlyBars,
      { ...config, n: bestN }, testStart, testEnd,
    );
    const testMetrics = calcMetrics(
      bestN, config.markets, 'test',
      testStart, testEnd,
      config.initialCapital, testTrades, testCurve,
    );

    return { bestN, trainMetrics, testMetrics, scanResults };
  }
}
