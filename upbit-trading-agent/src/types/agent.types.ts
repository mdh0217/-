/**
 * 에이전트 내부 타입 정의
 */

export type TradingMode = 'paper' | 'live'

export interface PortfolioSummary {
  krwAvailable: number
  krwLocked: number
  holdings: Array<{
    currency: string
    balance: number
    avgBuyPrice: number
  }>
}

export interface RateLimitStatus {
  privateAvailable: number
  publicAvailable: number
}

// 래리 윌리엄스 변동성 돌파 신호
export type SignalType = 'BUY' | 'SELL' | 'HOLD'

export interface VolatilitySignal {
  market: string
  type: SignalType
  currentPrice: number
  targetPrice: number
  range: number
  k: number
  generatedAt: Date
}

// 페이퍼 트레이딩 포지션
export interface PaperPosition {
  market: string
  avgPrice: number
  volume: number
  totalKrw: number
  entryTime: Date
  currentPrice?: number
  dca_level: number
}

// 페이퍼 트레이딩 거래 기록
export interface PaperTrade {
  market: string
  side: 'buy' | 'sell'
  price: number
  volume: number
  totalKrw: number
  pnl?: number
  pnlPct?: number
  executedAt: Date
}
