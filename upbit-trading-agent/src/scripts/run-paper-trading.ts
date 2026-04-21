/**
 * 가상 매매 엔진 실행 스크립트
 *
 * 사용법:
 *   단일 순환:  npx ts-node src/scripts/run-paper-trading.ts
 *   연속 루프:  LOOP=true npx ts-node src/scripts/run-paper-trading.ts
 *   인터벌:     LOOP=true INTERVAL_SEC=30 npx ts-node src/scripts/run-paper-trading.ts
 */

import 'dotenv/config';
import { validateEnv, env }        from '../config/env';
validateEnv();
import { getUpbitClient }          from '../data/upbit-client';
import { TradingEngine }           from '../engine/trading-engine';
import { getDatabase }             from '../database/db';
import { registerShutdownHandlers } from '../core/shutdown';
import { notifyShutdown }          from '../notifications/discord';
import { logger }                  from '../utils/logger';

async function main(): Promise<void> {
  const client = getUpbitClient();
  const engine = new TradingEngine(client);

  await engine.initialize();

  const loopMode    = process.env['LOOP'] === 'true';
  const intervalSec = env.intervalSec;

  if (loopMode) {
    const db = await getDatabase(); // engine.initialize() 가 이미 호출했으므로 싱글턴 반환

    registerShutdownHandlers(engine, () => {}, db, async (cause, krwBalance) => {
      if (cause.kind === 'signal') {
        await notifyShutdown({ kind: 'signal', signal: cause.signal, krwBalance });
      } else {
        await notifyShutdown({ kind: 'error', errorMsg: cause.error.message, krwBalance });
      }
    });

    await engine.start(intervalSec * 1000);
  } else {
    await engine.runOnce();
  }
}

main().catch((err: Error) => {
  logger.error(`[Fatal] ${err.message}`);
  process.exit(1);
});
