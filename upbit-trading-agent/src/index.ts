/**
 * 업비트 24시간 자율 트레이딩 에이전트
 * 진입점 (Entry Point)
 */

import 'dotenv/config';
import { validateEnv, env }         from './config/env';
import { logger }                   from './utils/logger';
validateEnv();
import { getUpbitClient }           from './data/upbit-client';
import { TradingEngine }            from './engine/trading-engine';
import { getDatabase }              from './database/db';
import { registerShutdownHandlers } from './core/shutdown';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  Upbit 자율 트레이딩 에이전트 v0.1.0');
  console.log(`  모드: ${process.env['TRADING_MODE'] ?? 'paper'}`);
  console.log(`  시작 시각: ${new Date().toLocaleString('ko-KR')}`);
  console.log('='.repeat(60));

  const client = getUpbitClient();

  // ── 시작 전 계좌 잔고 확인 ──────────────────────────────
  try {
    console.log('\n[초기화] 계좌 잔고 조회 중...');
    const portfolio = await client.getPortfolioSummary();

    console.log(`  KRW 사용 가능: ${portfolio.krwAvailable.toLocaleString('ko-KR')}원`);
    console.log(`  KRW 주문 중:   ${portfolio.krwLocked.toLocaleString('ko-KR')}원`);

    if (portfolio.holdings.length > 0) {
      console.log('\n  보유 코인:');
      for (const h of portfolio.holdings) {
        console.log(
          `    ${h.currency}: ${h.balance} (평균매수가: ${h.avgBuyPrice.toLocaleString('ko-KR')}원)`,
        );
      }
    } else {
      console.log('  보유 코인: 없음');
    }

    const rateLimitStatus = client.getRateLimitStatus();
    console.log(`\n  Rate Limit - Private: ${rateLimitStatus.privateAvailable}토큰, Public: ${rateLimitStatus.publicAvailable}토큰`);
  } catch (err) {
    const error = err as Error;
    console.error(`\n[오류] 계좌 조회 실패: ${error.message}`);
    console.error('  .env 파일의 API 키를 확인하세요.');
    process.exit(1);
  }

  // ── 트레이딩 엔진 시작 ───────────────────────────────────
  const engine = new TradingEngine(client);
  await engine.initialize();

  const db = await getDatabase(); // engine.initialize()가 이미 호출했으므로 싱글턴 반환

  registerShutdownHandlers(engine, () => {}, db);

  const intervalSec = env.intervalSec;
  await engine.start(intervalSec * 1000);
}

main().catch((err: Error) => {
  logger.error(`[Fatal] ${err.message}`);
  process.exit(1);
});
