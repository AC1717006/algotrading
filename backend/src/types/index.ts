import { Request } from 'express';
import { UserRole } from '@prisma/client';

// ─── JWT ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;      // userId
  email: string;
  role: UserRole;
  jti: string;      // unique token id for blacklisting
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user: JwtPayload;
}

// ─── API response envelope ───────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
  meta?: { page?: number; limit?: number; total?: number };
}

// ─── Market Data ─────────────────────────────────────────────────────────────
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

// ─── Upstox API shapes ───────────────────────────────────────────────────────
export interface UpstoxOrderPayload {
  instrument_token: string;
  order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  transaction_type: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  trigger_price?: number;
  disclosed_quantity?: number;
  validity: 'DAY' | 'IOC';
  product: string;
  tag?: string;
  is_amo?: boolean;
}

export interface UpstoxOrderResponse {
  order_id: string;
  status: string;
}

// ─── Upstox GTT (Good Till Triggered) bracket orders ─────────────────────────
export interface UpstoxGttRule {
  strategy: 'ENTRY' | 'TARGET' | 'STOPLOSS';
  trigger_type: 'IMMEDIATE' | 'ABOVE' | 'BELOW';
  trigger_price: number;
}

export interface UpstoxGttOrderPayload {
  type: 'SINGLE' | 'OCO';
  quantity: number;
  product: string;
  instrument_token: string;
  transaction_type: 'BUY' | 'SELL';
  rules: UpstoxGttRule[];
}

export interface UpstoxGttOrderResponse {
  gtt_order_ids: string[];
}

// ─── Trading ─────────────────────────────────────────────────────────────────
export type TradingMode = 'PAPER' | 'LIVE';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
export type Product = 'MIS' | 'CNC' | 'NRML';

export interface PlaceOrderRequest {
  symbol: string;
  exchange: string;
  instrumentToken: string;
  side: OrderSide;
  qty?: number;
  orderType: OrderType;
  product: Product;
  price?: number;
  triggerPrice?: number;
  stopLoss?: number;
  target?: number;
  strategyId?: string;
  tag?: string;
}

// ─── Risk ─────────────────────────────────────────────────────────────────────
export interface RiskCheckResult {
  passed: boolean;
  reason?: string;
}

// ─── Strategy ─────────────────────────────────────────────────────────────────
export interface StrategySignal {
  type: OrderSide | 'HOLD';
  symbol: string;
  exchange: string;
  price: number;
  strength: number;
  reason: string;
  indicators: Record<string, number | string>;
  stopLoss?: number;
  target?: number;
}

export interface StrategyRiskConfig {
  stopLossPercent: number;
  targetPercent: number;
  maxPositionValue: number;
  trailingStop: boolean;
  trailingStopPercent?: number;
}

export interface StrategyParams {
  // EMA
  fastPeriod?: number;
  slowPeriod?: number;
  // RSI
  period?: number;
  oversold?: number;
  overbought?: number;
  // MACD
  signalPeriod?: number;
  // Breakout
  lookback?: number;
  volumeMultiplier?: number;
  // Custom
  emaTrend?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  [key: string]: unknown;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
export interface WsMessage {
  type: 'QUOTE' | 'ORDER_UPDATE' | 'POSITION_UPDATE' | 'SIGNAL' | 'ALERT' | 'MTM_UPDATE';
  payload: unknown;
  timestamp: number;
}

// ─── S3 ───────────────────────────────────────────────────────────────────────
export interface S3UploadResult {
  key: string;
  bucket: string;
  url: string;
}
