/**
 * 백테스트 진입점
 *
 * 사용법:
 *   npm run backtest                            기본 실행 (BTC·ETH·XRP, 90일, N=20)
 *   npm run backtest -- --days 120 --n 30       단일 N 실행
 *   npm run backtest -- --optimize              N 최적화 + out-of-sample 검증
 *   npm run backtest -- --market KRW-BTC        단일 마켓
 */

import 'dotenv/config';
import { BacktestDataLoader } from './data-loader';
import { BacktestSimulator } from './simulator';
import { BacktestOptimizer, calcMetrics } from './optimizer';
import { printMetrics, printPerMarketBreakdown, printScanSummary, printTopTrades, printWarnings, exportCsv } from './reporter';
import { BacktestConfig, DailyBar, HourlyBar } from './types';
import { ANSI } from '../utils/color';

// ── 기본 설정 ─────────────────────────────────────────────────────────────────

const DEFAULT_MARKETS         = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP'];
const ALL_MAJOR_MARKETS       = [
  'KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOGE',
  'KRW-ADA', 'KRW-AVAX', 'KRW-LINK', 'KRW-TRX', 'KRW-DOT',
  'KRW-BCH', 'KRW-ETC', 'KRW-STX', 'KRW-ATOM', 'KRW-SUI',
];
const DEFAULT_DAYS            = 90;
const DEFAULT_N               = 20;   // 표준 터틀 기간
const DEFAULT_INITIAL_CAPITAL = 10_000_000;
const DEFAULT_TRAIN_RATIO     = 0.7;

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────

function parseArgs(): {
  markets: string[];
  days: number;
  n: number;
  optimize: boolean;
  compare: boolean;
  initialCapital: number;
  minRangeRate?: number;
  btcDropOverride?: number;
  disableBtcMaBlock: boolean;
} {
  const args = process.argv.slice(2);
  const get  = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const marketArg     = get('--market');
  const marketsArg    = get('--markets');
  const minRangeArg   = get('--min-range');
  const btcDropArg    = get('--btc-drop');

  const markets =
    args.includes('--all-markets') ? ALL_MAJOR_MARKETS :
    marketsArg !== undefined       ? marketsArg.split(',').map(s => s.trim()) :
    marketArg  !== undefined       ? [marketArg] :
    DEFAULT_MARKETS;

  return {
    markets,
    days:              Number(get('--days')    ?? DEFAULT_DAYS),
    n:                 Number(get('--n')       ?? DEFAULT_N),
    optimize:          args.includes('--optimize'),
    compare:           args.includes('--compare'),
    initialCapital:    Number(get('--capital') ?? DEFAULT_INITIAL_CAPITAL),
    minRangeRate:      minRangeArg !== undefined ? Number(minRangeArg) : (undefined as unknown as number),
    btcDropOverride:   btcDropArg  !== undefined ? Number(btcDropArg)  : (undefined as unknown as number),
    disableBtcMaBlock: args.includes('--no-btc-ma'),
  };
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────

async function loadData(
  loader: BacktestDataLoader,
  markets: string[],
  days: number,
): Promise<{
  marketDailyBars:  Map<string, DailyBar[]>;
  marketHourlyBars: Map<string, HourlyBar[]>;
  btcHourlyBars:    HourlyBar[];
}> {
  const marketDailyBars  = new Map<string, DailyBar[]>();
  const marketHourlyBars = new Map<string, HourlyBar[]>();

  const allMarkets = markets.includes('KRW-BTC') ? markets : ['KRW-BTC', ...markets];

  for (const market of allMarkets) {
    marketDailyBars.set(market,  await loader.getDailyBars(market, days));
    marketHourlyBars.set(market, await loader.getHourlyBars(market, days));
  }

  const btcHourlyBars = marketHourlyBars.get('KRW-BTC') ?? [];

  const targetDailyBars  = new Map<string, DailyBar[]>();
  const targetHourlyBars = new Map<string, HourlyBar[]>();
  for (const m of markets) {
    const d = marketDailyBars.get(m);
    const h = marketHourlyBars.get(m);
    if (d) targetDailyBars.set(m, d);
    if (h) targetHourlyBars.set(m, h);
  }

  return {
    marketDailyBars:  targetDailyBars,
    marketHourlyBars: targetHourlyBars,
    btcHourlyBars,
  };
}

// ── 단일 N 실행 기간 추출 ─────────────────────────────────────────────────────

function deriveTestRange(
  marketDailyBars: Map<string, DailyBar[]>,
  days: number,
): { startDate: string; endDate: string } {
  let longestBars: DailyBar[] = [];
  for (const bars of marketDailyBars.values()) {
    if (bars.length > longestBars.length) longestBars = bars;
  }
  const testBars = longestBars.slice(-days);
  return {
    startDate: testBars[0]?.dateKst ?? '',
    endDate:   testBars.at(-1)?.dateKst ?? '',
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('\n' + '='.repeat(60));
  console.log(`${ANSI.bold}  업비트 N일 고점 돌파 전략 — 백테스트${ANSI.reset}`);
  console.log('='.repeat(60));
  console.log(`  마켓:    ${args.markets.join(', ')}`);
  console.log(`  기간:    ${args.days}일`);
  console.log(`  자본:    ${args.initialCapital.toLocaleString('ko-KR')}원`);
  console.log(`  모드:    ${args.compare ? '전략 변형 비교' : args.optimize ? 'N 최적화' : `단일 N=${args.n}일`}`);
  console.log('='.repeat(60));

  const loader = new BacktestDataLoader();

  console.log('\n[1/3] 데이터 로드 중...');
  const { marketDailyBars, marketHourlyBars, btcHourlyBars } =
    await loadData(loader, args.markets, args.days);

  const config: BacktestConfig = {
    markets:           args.markets,
    days:              args.days,
    initialCapital:    args.initialCapital,
    n:                 args.n,
    trainRatio:        DEFAULT_TRAIN_RATIO,
    disableBtcMaBlock: true,   // 라이브 봇과 동일: MA 차단 제거됨
    ...(args.minRangeRate    !== undefined && { minRangeRate:    args.minRangeRate }),
    ...(args.btcDropOverride !== undefined && { btcDropOverride: args.btcDropOverride }),
    ...(!args.disableBtcMaBlock            && {}), // --no-btc-ma 무시 (이미 기본값)
  };

  if (args.compare) {
    // ── 전략 변형 비교 모드 ──────────────────────────────────────────────────
    const simulator = new BacktestSimulator();
    const { startDate, endDate } = deriveTestRange(marketDailyBars, args.days);

    if (!startDate || !endDate) {
      console.error('[오류] 테스트 기간을 추출할 수 없습니다.');
      process.exit(1);
    }

    const variants: Array<{ label: string; cfg: BacktestConfig }> = [
      { label: '① 기본 (현재 봇 설정)',                cfg: { ...config } },
      { label: '② 최소변동폭 0.5% 필터',               cfg: { ...config, minRangeRate: 0.005 } },
      { label: '③ 최소변동폭 1.0% 필터',               cfg: { ...config, minRangeRate: 0.010 } },
      { label: '④ BTC 차단 완화 (-3%)',                cfg: { ...config, btcDropOverride: -0.03 } },
      { label: '⑤ BTC MA 차단 재적용 (확인용)',        cfg: { ...config, disableBtcMaBlock: false } },
      { label: '⑥ 완화 + 변동폭 0.5% 조합',           cfg: { ...config, btcDropOverride: -0.03, minRangeRate: 0.005 } },
      { label: '⑦ 트레일링 구버전 (+3% 활성/-1.5%)',  cfg: { ...config, trailingActivateOverride: 0.03,  trailingTriggerOverride: 0.015 } },
      { label: '⑧ 트레일링 긴축 (+2%/-2%)',           cfg: { ...config, trailingActivateOverride: 0.02,  trailingTriggerOverride: 0.02  } },
      { label: '⑨ DCA 비활성화',                      cfg: { ...config, disableDca: true } },
      { label: '⑩ 포지션 상한 3개 (라이브 봇 동일)', cfg: { ...config, maxPositions: 3 } },
      { label: '⑪ 포지션 상한 4개',                   cfg: { ...config, maxPositions: 4 } },
      { label: '⑫ 포지션 상한 5개',                   cfg: { ...config, maxPositions: 5 } },
    ];

    console.log('\n[2/3] 변형별 시뮬레이션 실행 중...\n');

    const results: Array<{
      label: string;
      m: ReturnType<typeof calcMetrics>;
      skipped: number;
      dist: Map<number, number>;
    }> = [];

    for (const { label, cfg } of variants) {
      const { trades, equityCurve, skippedByPositionCap, simultaneousPositionDist } = simulator.run(
        marketDailyBars, marketHourlyBars, btcHourlyBars, cfg, startDate, endDate,
      );
      const m = calcMetrics(cfg.n, cfg.markets, 'test', startDate, endDate,
        cfg.initialCapital, trades, equityCurve);
      results.push({ label, m, skipped: skippedByPositionCap, dist: simultaneousPositionDist });

      const icon   = m.totalReturnPct >= 0 ? ANSI.green : ANSI.red;
      const skipTxt = skippedByPositionCap > 0 ? `  스킵=${skippedByPositionCap}회` : '';
      console.log(
        `  ${label.padEnd(32)}` +
        `  수익률=${icon}${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%${ANSI.reset}` +
        `  샤프=${m.sharpeRatio.toFixed(2).padStart(5)}` +
        `  MDD=${m.maxDrawdownPct.toFixed(2)}%` +
        `  거래=${String(m.tradeCount).padStart(3)}회` +
        `  승률=${m.winRate.toFixed(0)}%` +
        skipTxt,
      );
    }

    // ── 동시 포지션 분포 출력 (① 기본 기준) ──────────────────────────────────
    const baseDist = results[0]?.dist;
    if (baseDist) {
      console.log('\n  [동시 포지션 분포 — ① 기본 설정 기준]');
      const totalDays = [...baseDist.values()].reduce((s, v) => s + v, 0);
      [...baseDist.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([cnt, days]) => {
          const pct = ((days / totalDays) * 100).toFixed(1);
          const bar = '█'.repeat(Math.round(days / totalDays * 30));
          console.log(`    동시 ${cnt}개: ${String(days).padStart(3)}일 (${pct.padStart(4)}%) ${bar}`);
        });
    }

    console.log('\n[3/3] 최고 샤프 기준 상세 결과');
    const best = results.reduce((a, b) => a.m.sharpeRatio > b.m.sharpeRatio ? a : b);
    console.log(`\n  → 최선: ${best.label}`);
    printMetrics(best.m, best.label);
    printPerMarketBreakdown(best.m.perMarket);
    printWarnings(best.m);
    exportCsv(best.m);

  } else if (args.optimize) {
    // ── 최적화 모드 ──────────────────────────────────────────────────────────
    console.log('\n[2/3] N값 최적화 실행 중...');
    const optimizer = new BacktestOptimizer();

    const allDates = new Set<string>();
    for (const bars of marketDailyBars.values()) {
      bars.slice(-args.days).forEach(b => allDates.add(b.dateKst));
    }
    const allDays = [...allDates].sort();

    const result = optimizer.optimize(
      marketDailyBars,
      marketHourlyBars,
      btcHourlyBars,
      config,
      allDays,
    );

    console.log('\n[3/3] 결과 출력');
    printScanSummary(result.scanResults, result.bestN);
    printMetrics(result.trainMetrics, `학습 기간 (N=${result.bestN}일)`);
    printMetrics(result.testMetrics,  `검증 기간 — Out-of-Sample (N=${result.bestN}일)`);
    printPerMarketBreakdown(result.testMetrics.perMarket);
    printTopTrades(result.testMetrics.trades, '검증 기간 주요 거래');
    printWarnings(result.testMetrics);
    exportCsv(result.testMetrics);

  } else {
    // ── 단일 N 모드 ──────────────────────────────────────────────────────────
    console.log(`\n[2/3] N=${args.n}일 고점 돌파 시뮬레이션 실행 중...`);
    const simulator = new BacktestSimulator();
    const { startDate, endDate } = deriveTestRange(marketDailyBars, args.days);

    if (!startDate || !endDate) {
      console.error('[오류] 테스트 기간을 추출할 수 없습니다. 데이터를 확인하세요.');
      process.exit(1);
    }

    const { trades, equityCurve } = simulator.run(
      marketDailyBars,
      marketHourlyBars,
      btcHourlyBars,
      config,
      startDate,
      endDate,
    );

    const metrics = calcMetrics(
      args.n, args.markets, 'test',
      startDate, endDate,
      args.initialCapital, trades, equityCurve,
    );

    console.log('\n[3/3] 결과 출력');
    printMetrics(metrics, `백테스트 결과 (N=${args.n}일 고점 돌파)`);
    printPerMarketBreakdown(metrics.perMarket);
    printTopTrades(trades);
    printWarnings(metrics);
    exportCsv(metrics);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch((err: Error) => {
  console.error(`\n[Fatal] ${err.message}`);
  process.exit(1);
});
