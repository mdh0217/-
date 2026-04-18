/**
 * 업비트 통신 무결성 테스트
 *
 * 실행: npx ts-node src/scripts/connectivity-test.ts
 *
 * 테스트 항목:
 *   [1] Public API  - BTC 실시간 시세 조회 (인증 불필요)
 *   [2] Public API  - BTC 최근 캔들 5개 조회
 *   [3] Private API - 계좌 잔고 조회 (API 키 필요)
 *   [4] Rate Limit  - 연속 3회 호출 시 버킷 소비 현황
 */

import 'dotenv/config';
import { UpbitClient, getUpbitClient } from '../data/upbit-client';

// ─────────────────────────────────────────────────────────
// 출력 유틸리티
// ─────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;

function pass(label: string) { console.log(`  ${green('✓')} ${label}`); }
function fail(label: string, err: string) { console.log(`  ${red('✗')} ${label}\n    ${red('→')} ${err}`); }
function info(label: string) { console.log(`  ${dim('ℹ')} ${label}`); }
function section(title: string) {
  console.log('');
  console.log(bold(`[ ${title} ]`));
}

// ─────────────────────────────────────────────────────────
// 테스트 러너
// ─────────────────────────────────────────────────────────

async function runTest(
  label: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    pass(`${label} ${dim(`(${ms}ms)`)}`);
    return true;
  } catch (err) {
    fail(label, (err as Error).message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('═'.repeat(60));
  console.log(bold('  업비트 통신 무결성 테스트'));
  console.log(`  ${dim(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}`);
  console.log('═'.repeat(60));

  const results: boolean[] = [];

  // ── [1] Public API: BTC 현재 시세 ─────────────────────────
  section('TEST 1 · Public API — BTC 실시간 시세');

  // Public API는 API 키 없이도 호출 가능하므로 더미 클라이언트 사용
  const publicClient = new UpbitClient({
    accessKey: process.env['UPBIT_ACCESS_KEY'] ?? 'public-test-key',
    secretKey: process.env['UPBIT_SECRET_KEY'] ?? 'public-test-secret',
  });

  let btcPrice = 0;

  results.push(
    await runTest('GET /v1/ticker (KRW-BTC)', async () => {
      const tickers = await publicClient.getTicker(['KRW-BTC']);
      const btc = tickers[0];
      if (!btc) throw new Error('티커 데이터가 없습니다');

      btcPrice = btc.trade_price;

      info(`현재가:    ${btc.trade_price.toLocaleString('ko-KR')}원`);
      info(`전일 종가: ${btc.prev_closing_price.toLocaleString('ko-KR')}원`);
      info(`등락률:    ${(btc.signed_change_rate * 100).toFixed(2)}% (${btc.change})`);
      info(`24h 거래대금: ${(btc.acc_trade_price_24h / 1_000_000_000).toFixed(1)}억원`);
      info(`타임스탬프: ${new Date(btc.timestamp).toLocaleTimeString('ko-KR')}`);
    }),
  );

  // ── [2] Public API: BTC 일봉 캔들 ─────────────────────────
  section('TEST 2 · Public API — BTC 일봉 캔들 (최근 5일)');

  results.push(
    await runTest('GET /v1/candles/days (count=5)', async () => {
      const candles = await publicClient.getDayCandles('KRW-BTC', 5);
      if (candles.length === 0) throw new Error('캔들 데이터가 없습니다');

      console.log('');
      console.log(dim('  날짜(KST)       시가           고가           저가           종가'));
      console.log(dim('  ' + '─'.repeat(80)));

      for (const c of candles) {
        const date = c.candle_date_time_kst.slice(0, 10);
        const fmt = (n: number) => n.toLocaleString('ko-KR').padStart(13);
        console.log(`  ${date}   ${fmt(c.opening_price)} ${fmt(c.high_price)} ${fmt(c.low_price)} ${fmt(c.trade_price)}`);
      }

      // 변동성 계산 (래리 윌리엄스 K=0.5 기준 오늘 매수 목표가 미리 계산)
      const prev = candles[1];
      const today = candles[0];
      if (prev && today) {
        const range = prev.high_price - prev.low_price;
        const targetPrice = today.opening_price + range * 0.5;
        console.log('');
        info(`전일 변동폭 (고-저):   ${range.toLocaleString('ko-KR')}원`);
        info(`오늘 변동성 돌파 목표가 (K=0.5): ${targetPrice.toLocaleString('ko-KR')}원`);
        info(`현재가 ${btcPrice >= targetPrice ? green('≥ 목표가 → BUY 신호 발생') : red('< 목표가 → HOLD')}`);
      }
    }),
  );

  // ── [3] Public API: 복수 마켓 시세 (ETH, SOL 포함) ─────────
  section('TEST 3 · Public API — 복수 마켓 시세 조회');

  results.push(
    await runTest('GET /v1/ticker (KRW-BTC, KRW-ETH, KRW-SOL)', async () => {
      const markets = ['KRW-BTC', 'KRW-ETH', 'KRW-SOL'];
      const tickers = await publicClient.getTicker(markets);
      if (tickers.length !== 3) throw new Error(`예상 3개, 실제 ${tickers.length}개 수신`);

      console.log('');
      for (const t of tickers) {
        const sign = t.signed_change_rate >= 0 ? green('+') : red('-');
        const changeStr = `${sign}${Math.abs(t.signed_change_rate * 100).toFixed(2)}%`;
        info(`${t.market.padEnd(12)} ${t.trade_price.toLocaleString('ko-KR').padStart(15)}원  ${changeStr}`);
      }
    }),
  );

  // ── [4] Rate Limit 버킷 상태 확인 ────────────────────────
  section('TEST 4 · Rate Limit 버킷 소비 현황');

  results.push(
    await runTest('Token Bucket 잔여 토큰 확인', async () => {
      const status = publicClient.getRateLimitStatus();
      info(`Private API 버킷: ${status.privateAvailable}/8 토큰 남음`);
      info(`Public  API 버킷: ${status.publicAvailable}/20 토큰 남음`);

      if (status.publicAvailable < 0) {
        throw new Error('Public 버킷 토큰이 음수입니다 (버킷 로직 오류)');
      }
    }),
  );

  // ── [5] Private API: 계좌 잔고 ────────────────────────────
  section('TEST 5 · Private API — 계좌 잔고 조회');

  const hasApiKey =
    process.env['UPBIT_ACCESS_KEY'] &&
    process.env['UPBIT_ACCESS_KEY'] !== 'your_access_key_here';

  if (!hasApiKey) {
    console.log(`  ${yellow('⚠')}  ${yellow('UPBIT_ACCESS_KEY가 .env에 설정되지 않아 건너뜁니다.')}`);
    console.log(`  ${dim('   .env 파일에 실제 API 키를 입력한 후 재실행하세요.')}`);
  } else {
    results.push(
      await runTest('GET /v1/accounts', async () => {
        const client = getUpbitClient();
        const portfolio = await client.getPortfolioSummary();

        info(`KRW 사용 가능: ${portfolio.krwAvailable.toLocaleString('ko-KR')}원`);
        info(`KRW 주문 중:   ${portfolio.krwLocked.toLocaleString('ko-KR')}원`);

        if (portfolio.holdings.length === 0) {
          info('보유 코인: 없음');
        } else {
          console.log('');
          for (const h of portfolio.holdings) {
            const totalKrw = h.balance * h.avgBuyPrice;
            info(
              `${h.currency.padEnd(8)} ` +
                `잔고: ${h.balance.toFixed(8).padStart(16)}  ` +
                `평균가: ${h.avgBuyPrice.toLocaleString('ko-KR').padStart(13)}원  ` +
                `평가: ~${totalKrw.toLocaleString('ko-KR')}원`,
            );
          }
        }
      }),
    );
  }

  // ── 결과 요약 ──────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(60));
  const passed = results.filter(Boolean).length;
  const total = results.length;
  const allPass = passed === total;

  if (allPass) {
    console.log(green(bold(`  결과: ${passed}/${total} 통과  ✓ 통신 무결성 확인 완료`)));
  } else {
    console.log(red(bold(`  결과: ${passed}/${total} 통과  ✗ 일부 테스트 실패`)));
  }
  console.log('─'.repeat(60));
  console.log('');

  process.exit(allPass ? 0 : 1);
}

main().catch((err: Error) => {
  console.error(red(`\n[Fatal] ${err.message}`));
  process.exit(1);
});
