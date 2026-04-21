/**
 * 업비트 트레이딩 에이전트 - 공통 타입 정의
 */

// ─────────────────────────────────────────────────────────
// 업비트 API 응답 타입
// ─────────────────────────────────────────────────────────

export interface UpbitMarket {
  market: string;              // 마켓 코드 (KRW-BTC)
  korean_name: string;
  english_name: string;
  market_warning?: 'NONE' | 'CAUTION';
}

export interface UpbitAccount {
  currency: string;           // 화폐 코드 (BTC, ETH, KRW...)
  balance: string;            // 주문 가능 금액/수량
  locked: string;             // 주문 중 묶인 금액/수량
  avg_buy_price: string;      // 매수 평균가
  avg_buy_price_modified: boolean;
  unit_currency: string;      // 기준 화폐 (KRW)
}

export interface UpbitTicker {
  market: string;             // 마켓 코드 (KRW-BTC)
  trade_date: string;         // 최근 거래 일자 (UTC)
  trade_time: string;         // 최근 거래 시각 (UTC)
  trade_date_kst: string;
  trade_time_kst: string;
  trade_timestamp: number;    // 최근 거래 타임스탬프 (ms)
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;        // 현재가
  prev_closing_price: number; // 전일 종가
  change: 'EVEN' | 'RISE' | 'FALL';
  change_price: number;
  change_rate: number;
  signed_change_price: number;
  signed_change_rate: number;
  trade_volume: number;       // 가장 최근 거래량
  acc_trade_price: number;    // 누적 거래대금 (UTC 0시 기준)
  acc_trade_price_24h: number;
  acc_trade_volume: number;
  acc_trade_volume_24h: number;
  highest_52_week_price: number;
  highest_52_week_date: string;
  lowest_52_week_price: number;
  lowest_52_week_date: string;
  timestamp: number;
}

export interface UpbitOrderbookUnit {
  ask_price: number;          // 매도 호가
  bid_price: number;          // 매수 호가
  ask_size: number;           // 매도 잔량
  bid_size: number;           // 매수 잔량
}

export interface UpbitOrderbook {
  market: string;
  timestamp: number;
  total_ask_size: number;     // 호가 매도 총 잔량
  total_bid_size: number;     // 호가 매수 총 잔량
  orderbook_units: UpbitOrderbookUnit[];
}

export interface UpbitCandle {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;        // 종가
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
  unit?: number;              // 분 단위 캔들의 경우 분 단위 값
  prev_closing_price?: number; // 일 캔들의 경우 전일 종가
  change_price?: number;
  change_rate?: number;
}

// ─────────────────────────────────────────────────────────
// 주문 관련 타입
// ─────────────────────────────────────────────────────────

export type OrderSide = 'bid' | 'ask';   // bid: 매수, ask: 매도
export type OrderType = 'limit' | 'price' | 'market' | 'best';
// limit: 지정가, price: 시장가 매수(금액 기준), market: 시장가 매도(수량 기준)

export type OrderState = 'wait' | 'watch' | 'done' | 'cancel';

export interface PlaceOrderParams {
  market: string;             // 마켓 코드 (KRW-BTC)
  side: OrderSide;
  volume?: string;            // 매도 수량 (ask 시 필수)
  price?: string;             // 매수 금액 또는 지정가 (bid 시 필수)
  ord_type: OrderType;
  identifier?: string;        // 클라이언트 고유 주문 ID
}

export interface UpbitOrder {
  uuid: string;               // 주문 고유 ID
  side: OrderSide;
  ord_type: OrderType;
  price: string;
  state: OrderState;
  market: string;
  created_at: string;
  volume: string;
  remaining_volume: string;
  reserved_fee: string;
  remaining_fee: string;
  paid_fee: string;
  locked: string;
  executed_volume: string;
  trades_count: number;
}

// ─────────────────────────────────────────────────────────
// 클라이언트 설정 타입
// ─────────────────────────────────────────────────────────

export interface UpbitClientConfig {
  accessKey: string;
  secretKey: string;
  /** Private API 초당 요청 한도 (기본: 8, 업비트 공식 한도: 10) */
  privateRateLimit?: number;
  /** Public API 초당 요청 한도 (기본: 20, 업비트 공식 한도: 30) */
  publicRateLimit?: number;
  /** 재시도 최대 횟수 (기본: 3) */
  maxRetries?: number;
  /** 재시도 기본 대기 시간 ms (기본: 1000) */
  retryBaseDelay?: number;
  /** 요청 타임아웃 ms (기본: 10000) */
  timeout?: number;
}

// ─────────────────────────────────────────────────────────
// 에러 타입
// ─────────────────────────────────────────────────────────

export interface UpbitApiErrorResponse {
  error: {
    name: string;
    message: string;
  };
}

export class UpbitApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorName: string,
    message: string,
  ) {
    super(`[${statusCode}] ${errorName}: ${message}`);
    this.name = 'UpbitApiError';
  }

  /** 재시도 가능한 에러인지 판별 */
  get isRetryable(): boolean {
    // 429: Too Many Requests, 5xx: 서버 에러
    return this.statusCode === 429 || this.statusCode >= 500;
  }
}

// ─────────────────────────────────────────────────────────
// 전략 관련 타입
// ─────────────────────────────────────────────────────────

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  market: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  price: number;
  reason: string;
  confidence: number;         // 0 ~ 1
  timestamp: number;
}

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

// ─────────────────────────────────────────────────────────
// 서킷 브레이커 타입
// ─────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** 서킷을 OPEN으로 전환할 연속 실패 횟수 (기본: 5) */
  failureThreshold?: number;
  /** OPEN 상태 유지 시간 ms - 이후 HALF_OPEN 전환 (기본: 60000) */
  resetTimeout?: number;
  /** HALF_OPEN에서 성공 처리로 볼 최소 성공 횟수 (기본: 2) */
  successThreshold?: number;
}

// ─────────────────────────────────────────────────────────
// 가상 매매 엔진 타입
// ─────────────────────────────────────────────────────────

/** 단일 매수 진입 기록 */
export interface PositionEntry {
  dca_level: number;   // 0=1차, 1=2차DCA, 2=3차DCA
  price: number;       // 매수가 (KRW)
  volume: number;      // 매수 수량 (코인)
  amount: number;      // 투자 KRW (수수료 포함)
  fee: number;         // 수수료 (KRW)
  timestamp: number;
}

export type PositionStatus = 'open' | 'closed';
export type ExitReason = 'stop_loss' | 'trailing_stop' | 'manual';
export type VirtualOrderSide = 'buy' | 'sell';
export type VirtualOrderType =
  | 'initial_buy'
  | 'dca_buy'
  | 'stop_loss_sell'
  | 'trailing_stop_sell';

export interface Position {
  id: number;
  market: string;
  status: PositionStatus;
  entries: PositionEntry[];
  avg_price: number;
  total_volume: number;      // 총 보유 수량
  total_invested: number;    // 총 투자 KRW
  dca_level: number;         // 현재까지 DCA 횟수 (0=초기 진입만)
  peak_price: number | null; // 트레일링 스탑용 고점
  trailing_active: boolean;
  stop_loss_price: number;   // 손절가 = avg_price × 0.97
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl: number | null;        // 실현 손익 (KRW)
  pnl_rate: number | null;   // 실현 손익률
  exit_reason: ExitReason | null;
}

export interface VirtualOrder {
  id: number;
  position_id: number;
  market: string;
  side: VirtualOrderSide;
  order_type: VirtualOrderType;
  price: number;
  volume: number;
  amount: number;
  fee: number;
  created_at: string;
}

export interface VirtualBalance {
  currency: string;
  available: number;
  locked: number;
}

/** 신호 분석 결과 */
export interface SignalAnalysis {
  market: string;
  timestamp: number;
  currentPrice: number;
  // N일 고점 돌파 (Turtle Trading)
  isNDayHighBreakout: boolean;
  breakoutTargetPrice: number;
  nDayHigh: number;
  n: number;
  // 이평선 정배열
  isMaAligned: boolean;
  ma5: number;
  ma20: number;
  ma60: number;
  // 더 긴 기간 고점 돌파 여부 (2N일 고점 ≈ N일 고점 → 대형 추세 확인)
  isLongerBreakout: boolean;
  // 종합
  signalStrength: 'strong' | 'normal' | 'none';
  recommendedPositionRate: number; // 0.15 or 0.25
  reasons: string[];
}
