/**
 * API 서킷 브레이커
 *
 * 연속 API 오류가 임계값을 초과하면 신규 매수·DCA를 차단합니다.
 * 손절·익절(managePosition)은 buyBlocked 와 무관하게 항상 실행됩니다.
 *
 * 상태 전이:
 *   closed ──N회 실패──→ open ──resetTimeoutMs 경과──→ closed (자동 복구)
 *
 * 재시작 시 항상 closed 로 초기화됩니다 (의도된 동작 — 재시작 = 운영자 개입).
 */

import { logger } from '../utils/logger';

export class CircuitBreaker {
  private failureCount = 0;
  private openedAt: number | null = null;

  /**
   * @param threshold      open 전환까지 허용하는 연속 실패 횟수
   * @param resetTimeoutMs open 상태 유지 시간 (ms) — 경과 후 자동 복구
   */
  constructor(
    private readonly threshold:      number,
    private readonly resetTimeoutMs: number,
  ) {}

  // ── 퍼블릭 API ──────────────────────────────────────────────────────────────

  /** API 호출 성공 시 호출. 실패 카운터를 초기화하고 서킷을 닫습니다. */
  recordSuccess(): void {
    if (this.openedAt !== null) {
      logger.info('[서킷] API 정상 응답 확인 — 서킷 복구');
    }
    this.failureCount = 0;
    this.openedAt     = null;
  }

  /** API 호출 실패 시 호출. 임계값 초과 시 서킷을 엽니다. */
  recordFailure(): void {
    this.failureCount++;

    if (this.failureCount >= this.threshold && this.openedAt === null) {
      this.openedAt = Date.now();
      logger.warn(
        `[서킷] 연속 ${this.failureCount}회 API 오류 — 서킷 개방` +
        ` (${Math.round(this.resetTimeoutMs / 1000)}초 후 자동 복구)`,
      );
    }
  }

  /**
   * 서킷이 열려 있으면 true 반환 (신규 매수·DCA 차단 신호).
   *
   * resetTimeoutMs 가 경과하면 카운터를 초기화하고 자동으로 closed 로 복구합니다.
   * 복구 후 최초 API 성공 시 recordSuccess()로 완전히 닫힙니다.
   */
  isOpen(): boolean {
    if (this.openedAt === null) return false;

    const elapsed = Date.now() - this.openedAt;

    if (elapsed >= this.resetTimeoutMs) {
      logger.info(
        `[서킷] 복구 대기(${Math.round(this.resetTimeoutMs / 1000)}초) 완료 — 자동 복구 시도`,
      );
      this.failureCount = 0;
      this.openedAt     = null;
      return false;
    }

    return true;
  }

  /** 현재 상태 문자열 (로그용) */
  get status(): string {
    if (this.openedAt === null) {
      return this.failureCount === 0
        ? 'closed'
        : `closed (실패 ${this.failureCount}/${this.threshold})`;
    }
    const remaining = Math.max(0, this.resetTimeoutMs - (Date.now() - this.openedAt));
    return `open — ${Math.round(remaining / 1000)}초 후 복구`;
  }
}
