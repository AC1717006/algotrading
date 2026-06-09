import { EMA, RSI, MACD } from 'technicalindicators';
import { Candle } from '../types';

export function calcEMA(candles: Candle[], period: number): number[] {
  return EMA.calculate({ period, values: candles.map((c) => c.close) });
}

export function calcRSI(candles: Candle[], period = 14): number[] {
  return RSI.calculate({ period, values: candles.map((c) => c.close) });
}

export interface MACDPoint {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export function calcMACD(candles: Candle[], fast = 12, slow = 26, signal = 9): MACDPoint[] {
  return MACD.calculate({
    fastPeriod: fast,
    slowPeriod: slow,
    signalPeriod: signal,
    values: candles.map((c) => c.close),
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
}

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    const pc = candles[i - 1]!.close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function rollingHigh(candles: Candle[], period: number): number {
  return Math.max(...candles.slice(-period).map((c) => c.high));
}

export function rollingLow(candles: Candle[], period: number): number {
  return Math.min(...candles.slice(-period).map((c) => c.low));
}

export function avgVolume(candles: Candle[], period: number): number {
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1]!;
}

export function prev<T>(arr: T[]): T {
  return arr[arr.length - 2]!;
}
