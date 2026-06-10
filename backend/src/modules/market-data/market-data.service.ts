import { upstoxClient } from '../broker/upstox.client';
import { cacheGet, cacheSet } from '../../database/client';
import { Candle, Quote } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'MarketData' });

const TOP_MOVERS_WATCHLIST = [
  'NSE_EQ|INE009A01021', // Reliance
  'NSE_EQ|INE040A01034', // HDFC Bank
  'NSE_EQ|INE062A01020', // SBI
  'NSE_EQ|INE090A01021', // ICICI Bank
  'NSE_EQ|INE467B01029', // TCS
  'NSE_EQ|INE148A01014', // Infosys
  'NSE_EQ|INE669C01036', // Bajaj Finance
  'NSE_EQ|INE585B01010', // Maruti
  'NSE_EQ|INE029A01011', // ITC
  'NSE_EQ|INE117A01022', // Wipro
  'MCX_FO|430069',   // Gold
  'MCX_FO|429117',   // Silver
  'MCX_FO|431196',   // Crude Oil
  'MCX_FO|430597',   // Natural Gas
  'MCX_FO|430135',   // Copper
];

interface RawQuote {
  last_price: number;
  ohlc?: { open: number; high: number; low: number; close: number };
  volume?: number;
  net_change?: number;
  net_change_percentage?: number;
}

class MarketDataService {
  private ltpCache = new Map<string, number>();

  async getHistoricalCandles(
    symbol: string,
    interval: string,
    fromDate: string,
    toDate: string,
  ): Promise<Candle[]> {
    const cacheKey = `candles:${symbol}:${interval}:${fromDate}:${toDate}`;
    const cached = await cacheGet<Candle[]>(cacheKey);
    if (cached) return cached;

    const raw = await upstoxClient.getHistoricalCandles(symbol, interval, toDate, fromDate);
    const candles: Candle[] = raw
      .map((c) => ({
        timestamp: new Date(c[0] as string).getTime(),
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    await cacheSet(cacheKey, candles, 60); // Cache 1 minute
    return candles;
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const rawQuotes = await upstoxClient.getQuotes(symbols) as Record<string, RawQuote>;
    const result: Record<string, Quote> = {};

    for (const [key, q] of Object.entries(rawQuotes)) {
      const quote: Quote = {
        symbol: key,
        ltp: q.last_price,
        open: q.ohlc?.open ?? 0,
        high: q.ohlc?.high ?? 0,
        low: q.ohlc?.low ?? 0,
        close: q.ohlc?.close ?? 0,
        volume: q.volume ?? 0,
        change: q.net_change ?? 0,
        changePercent: q.net_change_percentage ?? 0,
        timestamp: Date.now(),
      };
      result[key] = quote;
      this.ltpCache.set(key, quote.ltp);
    }

    return result;
  }

  async getTopMovers(): Promise<{ gainers: Quote[]; losers: Quote[] }> {
    const quotes = await this.getQuotes(TOP_MOVERS_WATCHLIST);
    const sorted = Object.values(quotes).sort((a, b) => b.changePercent - a.changePercent);
    return {
      gainers: sorted.slice(0, 10).filter((q) => q.changePercent > 0),
      losers: sorted.slice(-10).filter((q) => q.changePercent < 0).reverse(),
    };
  }

  getLtp(symbol: string): number {
    return this.ltpCache.get(symbol) ?? 0;
  }

  setLtp(symbol: string, ltp: number): void {
    this.ltpCache.set(symbol, ltp);
  }

  getAllLtps(): Record<string, number> {
    return Object.fromEntries(this.ltpCache);
  }
}

export const marketDataService = new MarketDataService();
