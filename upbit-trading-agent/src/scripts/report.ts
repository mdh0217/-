/**
 * 트레이딩 성과 리포트
 *
 * DB를 읽기 전용으로 조회해 성과 지표를 콘솔에 출력합니다.
 * 봇이 실행 중인 상태에서도 안전하게 실행할 수 있습니다.
 *
 *   npm run report
 */

import 'dotenv/config';
import { getDatabase } from '../database/db';
import { env }         from '../config/env';
import type { Position } from '../types/index';

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function krw(n: number): string {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

function pct(rate: number, digits = 2): string {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${(rate * 100).toFixed(digits)}%`;
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

const LINE = '═'.repeat(60);
const SEP  = '─'.repeat(60);

// ── 지표 계산 ─────────────────────────────────────────────────────────────────

interface MarketStat {
  pnl:   number;
  count: number;
  wins:  number;
}

/** 청산 순서 기준 최대 낙폭 (MDD) 계산 */
function calcMdd(sorted: Position[], initialKrw: number): number {
  let equity = initialKrw;
  let peak   = initialKrw;
  let mdd    = 0;

  for (const p of sorted) {
    equity += p.pnl ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > mdd) mdd = dd;
  }

  return mdd;
}

/** 연속 최대 승/패 스트릭 */
function calcStreak(sorted: Position[]): { maxWin: number; maxLoss: number } {
  let maxWin  = 0;
  let maxLoss = 0;
  let curWin  = 0;
  let curLoss = 0;

  for (const p of sorted) {
    if ((p.pnl ?? 0) > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    }
  }

  return { maxWin, maxLoss };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = await getDatabase();

  const balance       = db.getBalance('KRW');
  const openPositions = db.getAllOpenPositions();
  const closed        = db.getClosedPositions();

  const krwAvailable  = balance?.available ?? 0;
  const totalInvested = openPositions.reduce((s, p) => s + p.total_invested, 0);
  const totalAsset    = krwAvailable + totalInvested;
  const realizedPnl   = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);

  // 초기 자본 = 현재 총 자산 - 실현 손익 (DB 역산)
  // env.initialKrw 는 봇을 처음 시작할 때 DB에 넣은 값이지만,
  // 현재 .env 값이 다를 수 있으므로 DB에서 직접 역산합니다.
  const inferredInitial = totalAsset - realizedPnl;
  const netPnl          = realizedPnl;

  // ── 거래 통계 ─────────────────────────────────────────────────────────────

  const wins       = closed.filter((p) => (p.pnl ?? 0) > 0);
  const losses     = closed.filter((p) => (p.pnl ?? 0) <= 0);
  const winRate    = closed.length > 0 ? wins.length / closed.length : 0;
  const totalPnl   = realizedPnl;
  const avgPnl     = closed.length > 0 ? totalPnl / closed.length : 0;
  const stopLossCnt  = closed.filter((p) => p.exit_reason === 'stop_loss').length;
  const trailCnt     = closed.filter((p) => p.exit_reason === 'trailing_stop').length;

  const sortedByClose = [...closed].sort((a, b) =>
    (a.closed_at ?? '').localeCompare(b.closed_at ?? ''),
  );

  const mdd              = calcMdd(sortedByClose, inferredInitial);
  const mddRate          = inferredInitial > 0 ? mdd / inferredInitial : 0;
  const { maxWin, maxLoss } = calcStreak(sortedByClose);

  const bestTrade  = closed.reduce<Position | null>(
    (b, p) => b === null || (p.pnl ?? 0) > (b.pnl ?? 0) ? p : b, null,
  );
  const worstTrade = closed.reduce<Position | null>(
    (w, p) => w === null || (p.pnl ?? 0) < (w.pnl ?? 0) ? p : w, null,
  );

  // ── 종목별 집계 ───────────────────────────────────────────────────────────

  const byMarket = new Map<string, MarketStat>();

  for (const p of closed) {
    const cur = byMarket.get(p.market) ?? { pnl: 0, count: 0, wins: 0 };
    cur.pnl   += p.pnl ?? 0;
    cur.count += 1;
    cur.wins  += (p.pnl ?? 0) > 0 ? 1 : 0;
    byMarket.set(p.market, cur);
  }

  const marketEntries = [...byMarket.entries()].sort((a, b) => b[1].pnl - a[1].pnl);

  // ── 출력 ─────────────────────────────────────────────────────────────────

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  console.log('');
  console.log(LINE);
  console.log('  업비트 트레이딩 성과 리포트');
  console.log(`  기준 시각 : ${now}`);
  console.log(`  운영 모드 : ${env.tradingMode.toUpperCase()}`);
  console.log(LINE);

  // 포트폴리오 현황
  console.log('\n【 포트폴리오 현황 】');
  console.log(`  ${pad('초기 자본',       14)}: ${krw(inferredInitial)}`);
  console.log(`  ${pad('가용 KRW',        14)}: ${krw(krwAvailable)}`);
  console.log(`  ${pad('오픈 포지션',     14)}: ${openPositions.length}건  (투자 원금 ${krw(totalInvested)})`);
  console.log(`  ${pad('총 자산 추정',    14)}: ${krw(totalAsset)}`);
  const netRate = inferredInitial > 0 ? netPnl / inferredInitial : 0;
  console.log(`  ${pad('초기 자본 대비',  14)}: ${pct(netRate)}  (${netPnl >= 0 ? '+' : ''}${krw(netPnl)})`);

  // 거래 성과
  console.log('\n【 거래 성과 (청산 완료) 】');

  if (closed.length === 0) {
    console.log('  아직 청산된 거래가 없습니다.');
  } else {
    console.log(`  ${pad('총 거래 수',       14)}: ${closed.length}건`);
    console.log(`  ${pad('승률',             14)}: ${pct(winRate, 1)}  (${wins.length}승 ${losses.length}패)`);
    console.log(`  ${pad('총 손익',          14)}: ${pct(inferredInitial > 0 ? totalPnl / inferredInitial : 0)}  (${totalPnl >= 0 ? '+' : ''}${krw(totalPnl)})`);
    console.log(`  ${pad('거래당 평균 손익', 14)}: ${avgPnl >= 0 ? '+' : ''}${krw(avgPnl)}`);
    console.log(SEP);

    if (bestTrade) {
      console.log(
        `  ${pad('최대 단일 이익', 14)}: +${krw(bestTrade.pnl ?? 0)}` +
        `  ${bestTrade.market}  ${pct(bestTrade.pnl_rate ?? 0)}`,
      );
    }
    if (worstTrade) {
      console.log(
        `  ${pad('최대 단일 손실', 14)}: ${krw(worstTrade.pnl ?? 0)}` +
        `  ${worstTrade.market}  ${pct(worstTrade.pnl_rate ?? 0)}`,
      );
    }

    const mddStr = mdd === 0 ? '없음' : `${pct(-mddRate)}  (-${krw(mdd)})`;
    console.log(`  ${pad('최대 낙폭 (MDD)', 14)}: ${mddStr}`);
    console.log(`  ${pad('연속 최다 승/패', 14)}: ${maxWin}연승 / ${maxLoss}연패`);
    console.log(SEP);
    console.log(`  ${pad('손절 / 익절',     14)}: ${stopLossCnt}건 / ${trailCnt}건`);
  }

  // 종목별 손익
  if (marketEntries.length > 0) {
    console.log('\n【 종목별 손익 】');

    for (const [market, stat] of marketEntries) {
      const coin   = market.replace('KRW-', '');
      const sign   = stat.pnl >= 0 ? '+' : '';
      const wr     = stat.count > 0 ? Math.round((stat.wins / stat.count) * 100) : 0;
      console.log(
        `  ${pad(coin, 8)}: ${(sign + krw(stat.pnl)).padStart(14)}` +
        `  (${stat.count}건, 승률 ${wr}%)`,
      );
    }
  }

  // 오픈 포지션
  if (openPositions.length > 0) {
    console.log('\n【 오픈 포지션 】');

    for (const p of openPositions) {
      const coin    = p.market.replace('KRW-', '');
      const dcaStr  = p.dca_level > 0 ? `  DCA${p.dca_level}` : '';
      const trStr   = p.trailing_active ? '  [트레일링]' : '';
      console.log(
        `  ${pad(coin, 8)}: 평단 ${krw(p.avg_price)}` +
        `  투자 ${krw(p.total_invested)}` +
        `  손절가 ${krw(p.stop_loss_price)}` +
        `${dcaStr}${trStr}`,
      );
    }
  }

  console.log('\n' + LINE);
  console.log('');
}

main().catch((err: Error) => {
  console.error('[오류]', err.message);
  process.exit(1);
});
