/**
 * 핵심 매매 파라미터 상수
 *
 * 모든 전략·엔진 상수를 한곳에서 관리합니다.
 * 값을 바꾸려면 이 파일만 수정하면 됩니다.
 */

// ── 거래 전략 파라미터 ────────────────────────────────────────────────────────

export const TRADING = {
  /** 업비트 거래 수수료 0.05% */
  FEE_RATE: 0.0005,

  /** 손절선: 평단가 대비 -3% */
  STOP_LOSS_RATE: 0.03,

  /**
   * 트레일링 스탑 활성화: 평단 대비 +2%
   * (2.5% → 2%: 조기 활성화로 더 많은 수익 보호 — 365일 백테스트 확인)
   */
  TRAILING_ACTIVATE_RATE: 0.02,

  /**
   * 트레일링 스탑 익절 트리거: 고점 대비 -2%
   * (2.5% → 2%: 긴축 트리거로 수익 조기 실현 — Sharpe 5.06→5.26 개선)
   */
  TRAILING_TRIGGER_RATE: 0.02,

  /** 호가 스프레드 허용 상한 1.5% */
  SPREAD_THRESHOLD: 0.015,

  /** BTC 1시간 등락률이 이 이하면 신규 매수 차단 */
  BTC_DROP_THRESHOLD: -0.015,

  /**
   * DCA 트리거: 직전 진입가 대비 -2.5%
   * (기존 -1.5% → 확대: 노이즈 DCA 방지, 손절가와 충분한 간격 확보)
   */
  DCA_TRIGGER_RATE: 0.025,

  /**
   * DCA 최대 횟수: 1회 (초기 진입 후 추가 1회, 총 2회)
   * (기존 2회 → 축소: 하락 추세 역추적 손실 제한)
   */
  MAX_DCA_COUNT: 1,

  /**
   * DCA 후 손절선 강화 계수
   * 평단 재계산 후 손절 폭을 80%로 좁힘: avg × (1 - STOP_LOSS_RATE × 0.80)
   * → 3% × 0.80 = 2.4% 손절
   */
  DCA_STOP_FACTOR: 0.80,

  // ── 포지션 비율 ──────────────────────────────────────────────────────────────

  /** 일반 신호 포지션 비율 (가용 자본 대비) */
  NORMAL_POSITION_RATE: 0.15,

  /** 강력 신호 포지션 비율 (가용 자본 대비) */
  STRONG_POSITION_RATE: 0.25,

  // ── 쿨다운 ───────────────────────────────────────────────────────────────────

  /** 동일 마켓 연속 손절 이 횟수 이상 시 신규 진입 차단 */
  COOLDOWN_LOSSES: 2,

  /** 쿨다운 적용 일수 */
  COOLDOWN_DAYS: 3,

  /**
   * 마켓별 최적 N값 (365일 백테스트 per-market 최적화 기반)
   * 나머지 마켓은 env.nDayPeriod(기본 20) 사용
   */
  MARKET_N_VALUES: {
    'KRW-ADA':  25,  // N=25 Sharpe 1.65 vs N=20 1.17
    'KRW-SOL':  15,  // N=15 Sharpe confirmed
    'KRW-DOGE': 10,  // N=10 OOS Sharpe 2.36
    'KRW-TRX':  10,  // N=10 higher trade count, less overfit
    'KRW-DOT':  10,  // N=10 Sharpe 2.27 vs N=20 1.65
    'KRW-STX':  10,  // N=10 Sharpe 2.24 vs N=20 1.59
    'KRW-SUI':  15,  // N=15 Sharpe confirmed
  } as Record<string, number>,
} as const;

// ── 엔진 실행 파라미터 ────────────────────────────────────────────────────────

export const ENGINE = {
  /** 사이클 최대 실행 시간 (50초) */
  CYCLE_TIMEOUT_MS: 50_000,

  /** 연속 타임아웃 이 횟수 초과 시 쿨다운 진입 */
  COOLDOWN_TIMEOUT_COUNT: 3,

  /** 쿨다운 대기 시간 (5분) */
  COOLDOWN_MS: 5 * 60_000,

  /** 티커·호가창 신선도 유효 시간 (2분) */
  STALE_DATA_MS: 2 * 60_000,
} as const;
