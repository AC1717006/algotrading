import { upstoxClient } from '../broker/upstox.client';
import { cacheGet, cacheSet } from '../../database/client';
import { Candle, Quote } from '../../types';
import { logger } from '../../utils/logger';
import { instrumentMappingService } from './instrument-mapping';

const log = logger.child({ category: 'MarketData' });

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
    const instrumentKey = instrumentMappingService.getInstrumentKey(symbol);
    const cacheKey = `candles:${instrumentKey}:${interval}:${fromDate}:${toDate}`;
    const cached = await cacheGet<Candle[]>(cacheKey);
    if (cached) return cached;

    const raw = await upstoxClient.getHistoricalCandles(instrumentKey, interval, toDate, fromDate);
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

  async getHistory(
    symbol: string,
    interval: string,
    days: number,
  ): Promise<{ symbol: string; interval: string; from: string; to: string; candles: Candle[]; total: number }> {
    const instrumentKey = instrumentMappingService.getInstrumentKey(symbol);
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);

    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);

    const cacheKey = `history:${instrumentKey}:${interval}:${days}:${toStr}`;
    const cached = await cacheGet<{ symbol: string; interval: string; from: string; to: string; candles: Candle[]; total: number }>(cacheKey);
    if (cached) return cached;

    let raw: unknown[][] = [];

    if (interval === '1minute' && days > 30) {
      const chunkEnd = new Date(to);
      while (chunkEnd > from) {
        const chunkStart = new Date(chunkEnd);
        chunkStart.setDate(chunkStart.getDate() - 30);
        if (chunkStart < from) chunkStart.setTime(from.getTime());

        const chunk = await upstoxClient.getHistoricalCandles(
          instrumentKey,
          interval,
          chunkEnd.toISOString().slice(0, 10),
          chunkStart.toISOString().slice(0, 10),
        );
        raw = raw.concat(chunk);

        chunkEnd.setTime(chunkStart.getTime());
        chunkEnd.setDate(chunkEnd.getDate() - 1);
      }
    } else {
      raw = await upstoxClient.getHistoricalCandles(instrumentKey, interval, toStr, fromStr);
    }

    const seen = new Set<number>();
    const candles: Candle[] = raw
      .map((c) => ({
        timestamp: new Date(c[0] as string).getTime(),
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }))
      .filter((c) => {
        if (seen.has(c.timestamp)) return false;
        seen.add(c.timestamp);
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    const result = { symbol, interval, from: fromStr, to: toStr, candles, total: candles.length };
    await cacheSet(cacheKey, result, 6 * 60 * 60); // Cache 6 hours
    return result;
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const instrumentKeys = symbols.map((s) => instrumentMappingService.getInstrumentKey(s));
    const rawQuotes = await upstoxClient.getQuotes(instrumentKeys) as Record<string, RawQuote>;
    const result: Record<string, Quote> = {};

    // Upstox keys its quote response by "SEGMENT:TradingSymbol" (canonical
    // symbol), not by the instrument key that was requested — remap back to
    // whatever identifier the caller sent so lookups stay consistent.
    for (let i = 0; i < symbols.length; i++) {
      const requested = symbols[i];
      const instrumentKey = instrumentKeys[i];
      const canonical = instrumentMappingService.getCanonicalSymbol(requested);
      const q = rawQuotes[canonical] ?? rawQuotes[instrumentKey] ?? rawQuotes[requested];
      if (!q) continue;

      const quote: Quote = {
        symbol: requested,
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
      result[requested] = quote;
      this.ltpCache.set(instrumentKey, quote.ltp);
    }

    return result;
  }

  getLtp(symbol: string): number {
    return this.ltpCache.get(instrumentMappingService.getInstrumentKey(symbol)) ?? 0;
  }

  setLtp(symbol: string, ltp: number): void {
    this.ltpCache.set(symbol, ltp);
  }

  getAllLtps(): Record<string, number> {
    return Object.fromEntries(this.ltpCache);
  }
}

export const marketDataService = new MarketDataService();
