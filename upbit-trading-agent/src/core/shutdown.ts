/**
 * Graceful Shutdown 오케스트레이터
 *
 * 종료 순서:
 *   1. isShuttingDown 플래그 활성화 (중복 신호·새 사이클 차단)
 *   2. engine.stop() — 루프 플래그 off
 *   3. engine.waitForCurrentCycle() — 진행 중 사이클 완료 대기 (최대 55초, 5초마다 로그)
 *   4. onShutdown 훅 호출 — 종료 원인(signal / error) 전달
 *   5. closeServer() — HTTP 서버 종료
 *   6. db.flush() — DB 메모리 → 파일 최종 저장
 *   7. process.exit()
 *
 * 안전장치:
 *   - 이중 신호(Ctrl+C 두 번) → 즉시 process.exit(1)
 *   - uncaughtException / unhandledRejection → 동일 셧다운 시퀀스
 *   - executeShutdown 자체가 throw 해도 finally 에서 반드시 exit
 */

import type { TradingEngine }   from '../engine/trading-engine';
import type { DatabaseManager } from '../database/db';
import { logger }              from '../utils/logger';
import { writeShutdownStatus } from '../utils/statusFile';

// ── 타입 ──────────────────────────────────────────────────────────────────────

/** 종료 원인 — discriminated union */
export type ShutdownCause =
  | { kind: 'signal'; signal: string }
  | { kind: 'error';  error: Error   };

/**
 * 셧다운 알림 훅 타입.
 * 종료 직전에 호출됩니다. 실패해도 종료 흐름을 막지 않습니다.
 */
export type OnShutdownHook = (
  cause:      ShutdownCause,
  krwBalance: number,
) => Promise<void>;

// ── 상수 ──────────────────────────────────────────────────────────────────────

const CYCLE_WAIT_MS        = 30_000;   // 사이클 완료 최대 대기 (30초)
const PROGRESS_INTERVAL_MS =  5_000;   // 대기 중 진행 로그 주기
const FORCE_EXIT_MS        = 32_000;   // 하드 강제 종료 안전망 (32초)

// ── 모듈 상태 ─────────────────────────────────────────────────────────────────

let _isShuttingDown = false;

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * SIGTERM · SIGINT · uncaughtException · unhandledRejection 핸들러를 등록합니다.
 *
 * @param engine      TradingEngine 인스턴스
 * @param closeServer 웹서버 종료 함수 (startWebServer 반환값)
 * @param db          DatabaseManager 싱글턴
 * @param onShutdown  종료 알림 훅 (선택, 실패해도 종료 진행)
 */
export function registerShutdownHandlers(
  engine:      TradingEngine,
  closeServer: () => void,
  db:          DatabaseManager,
  onShutdown?: OnShutdownHook,
): void {

  const trigger = (cause: ShutdownCause): void => {
    // ── 이중 신호 안전장치 ─────────────────────────────────────────
    if (_isShuttingDown) {
      process.stderr.write('\n[셧다운] 이중 신호 감지 — 즉시 강제 종료\n');
      process.exit(1);
    }
    _isShuttingDown = true;

    // ── 하드 강제 종료 안전망 ─────────────────────────────────────
    // executeShutdown 이 어떤 이유로든 FORCE_EXIT_MS 안에 exit 하지 못하면
    // unref() 덕분에 정상 종료 시에는 타이머가 이벤트 루프를 붙잡지 않음
    const forceTimer = setTimeout(() => {
      process.stderr.write('\n[셧다운] 강제 종료 안전망 발동 (32초 초과)\n');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceTimer.unref();

    // executeShutdown은 async → void cast로 호출 (최상위 에러는 내부 catch)
    void executeShutdown(cause, engine, closeServer, db, onShutdown);
  };

  // ── 정상 종료 신호 ─────────────────────────────────────────────────────────
  process.on('SIGTERM', () => trigger({ kind: 'signal', signal: 'SIGTERM' }));
  process.on('SIGINT',  () => trigger({ kind: 'signal', signal: 'SIGINT'  }));

  // ── 예외 처리 ──────────────────────────────────────────────────────────────
  process.on('uncaughtException', (error: Error) => {
    logger.error(`[uncaughtException] ${error.stack ?? error.message}`);
    trigger({ kind: 'error', error });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error
      ? reason
      : new Error(String(reason));
    logger.error(`[unhandledRejection] ${error.stack ?? error.message}`);
    trigger({ kind: 'error', error });
  });
}

// ── 내부 구현 ─────────────────────────────────────────────────────────────────

async function executeShutdown(
  cause:       ShutdownCause,
  engine:      TradingEngine,
  closeServer: () => void,
  db:          DatabaseManager,
  onShutdown?: OnShutdownHook,
): Promise<void> {
  const label = cause.kind === 'signal' ? cause.signal : 'ERROR';
  logger.info(`[셧다운] 종료 시작 (${label})`);

  try {
    // STEP 1: 엔진 루프 플래그 off
    engine.stop();

    // STEP 2: 상태 파일에 중단 메시지 기록
    writeShutdownStatus(label);

    // STEP 3: 현재 사이클 완료 대기 (5초마다 경과 로그)
    await waitWithProgress(engine);

    // STEP 4: 알림 훅 (실패해도 종료 계속)
    if (onShutdown) {
      let krwBalance = 0;
      try { krwBalance = db.getBalance('KRW')?.available ?? 0; } catch { /* 초기화 전 방어 */ }
      await onShutdown(cause, krwBalance).catch((err: unknown) => {
        logger.warn(`[셧다운] 알림 훅 실패 (무시): ${(err as Error).message}`);
      });
    }

    // STEP 5: 웹서버 종료
    closeServer();
    logger.info('[셧다운] 웹서버 종료');

    // STEP 6: DB 최종 저장
    try {
      db.flush();
      logger.info('[셧다운] DB 저장 완료');
    } catch (err) {
      logger.warn(`[셧다운] DB 저장 실패 (무시): ${(err as Error).message}`);
    }

    logger.info('[셧다운] ✅ 안전하게 종료되었습니다.');

  } catch (err) {
    logger.error(`[셧다운] 종료 중 예외: ${(err as Error).message}`);
  } finally {
    // 어떤 상황에서도 반드시 프로세스 종료
    process.exit(cause.kind === 'error' ? 1 : 0);
  }
}

/**
 * engine.waitForCurrentCycle()을 호출하면서
 * 5초마다 경과 시간을 로그로 출력합니다.
 */
async function waitWithProgress(engine: TradingEngine): Promise<void> {
  const start   = Date.now();
  const maxSec  = CYCLE_WAIT_MS / 1000;

  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    logger.info(`[셧다운] 사이클 완료 대기 중 — ${elapsed}초 경과 / 최대 ${maxSec}초`);
  }, PROGRESS_INTERVAL_MS);

  try {
    await engine.waitForCurrentCycle(CYCLE_WAIT_MS);
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed >= 1) {
      logger.info(`[셧다운] 사이클 완료 확인 (${elapsed}초 소요)`);
    }
  } finally {
    clearInterval(timer);
  }
}
