/**
 * 백테스팅 전용 타입 정의
 */

/** 정규화된 일봉 데이터 */
export interface DailyBar {
  market: string;
  dateKst: string;       // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestampMs: number;
}

/** 정규화된 60분봉 데이터 */
export interface HourlyBar {
  market: string;
  datetimeKst: string;   // 'YYYY-MM-DDTHH:mm:ss'
  dateKst: string;       // 'YYYY-MM-DD' (날짜 그룹핑용)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 백테스트 실행 설정 */
export interface BacktestConfig {
  /** 테스트할 마켓 코드 목록 */
  markets: string[];
  /** 총 테스트 기간 (일) */
  days: number;
  /** 초기 자본 (KRW) */
  initialCapital: number;
  /** N일 고점 돌파 기간 */
  n: number;
  /** 학습/검증 기간 비율 (기본 0.7) */
  trainRatio: number;

  // ── 전략 변형 옵션 (A/B 테스트용) ───────────────────────────────────────────

  /**
   * 최소 변동폭 필터: 전일 레인지(고-저)/전일 종가 < 이 값이면 신호 스킵
   * 예) 0.005 → 0.5% 미만이면 "힘없는 돌파"로 간주, 진입 안 함
   * undefined → 필터 미적용 (기본)
   */
  minRangeRate?: number;

  /**
   * BTC 하락 차단 임계값 override (기본: TRADING.BTC_DROP_THRESHOLD = -0.015)
   * 예) -0.03 → -3% 이상 급락 시에만 차단 (완화)
   */
  btcDropOverride?: number;

  /**
   * BTC MA 역배열 차단 비활성화
   * true → MA5<MA20 조건 무시 (기본 false)
   */
  disableBtcMaBlock?: boolean;
}

/** 시뮬레이션 포지션 상태 (내부용) */
export interface SimPosition {
  market: string;
  entryDatetime: string;
  avgPrice: number;
  lastEntryPrice: number;   // DCA 트리거 계산용
  totalVolume: number;
  totalInvested: number;    // 총 투자 KRW (수수료 포함)
  dcaLevel: number;
  stopLossPrice: number;
  trailingActive: boolean;
  peakPrice: number;
  signalStrength: 'strong' | 'normal';
}

/** 단일 거래 기록 */
export interface SimulatedTrade {
  market: string;
  entryDatetime: string;
  exitDatetime: string;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  investedKrw: number;
  pnlKrw: number;
  pnlRate: number;
  exitReason: 'stop_loss' | 'trailing_stop' | 'end_of_data';
  dcaCount: number;
  signalStrength: 'strong' | 'normal';
}

/** 일별 자산 기록 (MDD·샤프 계산용) */
export interface EquityPoint {
  dateKst: string;
  equity: number;
}

/** 마켓별 성과 집계 */
export interface PerMarketMetrics {
  market: string;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnlKrw: number;
  avgWinPct: number;
  avgLossPct: number;
}

/** 백테스트 결과 지표 */
export interface BacktestMetrics {
  n: number;
  markets: string[];
  period: 'train' | 'test';
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  /** 총이익 / 총손실 (손실 없으면 Infinity) */
  profitFactor: number;
  /** 연환산 수익률 / 최대 낙폭 (MDD=0이면 0) */
  calmarRatio: number;
  /** 평균 보유 시간 (시간 단위) */
  avgHoldingHours: number;
  /** 포지션 보유 시간 / 총 테스트 시간 × 100 */
  marketExposurePct: number;
  /** 마켓별 성과 */
  perMarket: PerMarketMetrics[];
  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
}

/** 캐시 파일 포맷 */
export interface CachedData<T> {
  fetchedAt: number;
  data: T;
}
