/**
 * 업비트 API 응답 타입 정의
 */

export interface Account {
  currency: string
  balance: string
  locked: string
  avg_buy_price: string
  avg_buy_price_modified: boolean
  unit_currency: string
}

export interface Market {
  market: string
  korean_name: string
  english_name: string
}

export type ChangeType = 'RISE' | 'EVEN' | 'FALL'
export type MarketWarning = 'NONE' | 'CAUTION'

export interface Ticker {
  market: string
  trade_date: string
  trade_time: string
  trade_date_kst: string
  trade_time_kst: string
  trade_timestamp: number
  opening_price: number
  high_price: number
  low_price: number
  trade_price: number
  prev_closing_price: number
  change: ChangeType
  change_price: number
  change_rate: number
  signed_change_price: number
  signed_change_rate: number
  trade_volume: number
  acc_trade_price: number
  acc_trade_price_24h: number
  acc_trade_volume: number
  acc_trade_volume_24h: number
  highest_52_week_price: number
  highest_52_week_date: string
  lowest_52_week_price: number
  lowest_52_week_date: string
  timestamp: number
}

export interface Candle {
  market: string
  candle_date_time_utc: string
  candle_date_time_kst: string
  opening_price: number
  high_price: number
  low_price: number
  trade_price: number
  timestamp: number
  candle_acc_trade_price: number
  candle_acc_trade_volume: number
  unit?: number
}

export interface OrderbookUnit {
  ask_price: number
  bid_price: number
  ask_size: number
  bid_size: number
}

export interface Orderbook {
  market: string
  timestamp: number
  total_ask_size: number
  total_bid_size: number
  orderbook_units: OrderbookUnit[]
  level: number
}

export type OrderSide = 'bid' | 'ask'
export type OrderType = 'limit' | 'price' | 'market' | 'best'
export type OrderState = 'wait' | 'watch' | 'done' | 'cancel'

export interface OrderRequest {
  market: string
  side: OrderSide
  ord_type: OrderType
  price?: string
  volume?: string
  identifier?: string
}

export interface Order {
  uuid: string
  side: OrderSide
  ord_type: OrderType
  price: string
  state: OrderState
  market: string
  created_at: string
  volume: string
  remaining_volume: string
  reserved_fee: string
  remaining_fee: string
  paid_fee: string
  locked: string
  executed_volume: string
  trades_count: number
}

export interface UpbitApiError {
  error: {
    name: string
    message: string
  }
}
