'use client';

import { useCallback, useEffect, useState } from 'react';
import { marketApi } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { symbolLabel, useInstrumentDirectory } from '@/lib/instrument-mapping';
import { usePollInterval } from '@/hooks/usePollInterval';

const INDICES = [
  'NSE_INDEX|Nifty 50',
  'NSE_INDEX|Nifty Bank',
  'BSE_INDEX|SENSEX',
  'MCX_FO|466583',
  'MCX_FO|464150',
  'MCX_FO|499095',
];

const WATCHLIST = [
  'NSE_EQ|INE002A01018', // Reliance
  'NSE_EQ|INE040A01034', // HDFC Bank
  'NSE_EQ|INE062A01020', // SBI
  'NSE_EQ|INE090A01021', // ICICI Bank
  'NSE_EQ|INE467B01029', // TCS
  'NSE_EQ|INE009A01021', // Infosys
  'NSE_EQ|INE296A01032', // Bajaj Finance
  'NSE_EQ|INE585B01010', // Maruti
  'NSE_EQ|INE154A01025', // ITC
  'NSE_EQ|INE075A01022', // Wipro
];

const ALL_SYMBOLS = [...INDICES, ...WATCHLIST];

interface QuoteData {
  symbol: string;
  ltp: number;
  close: number;
  changePercent: number;
}

export function TickerBar() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [timedOut, setTimedOut] = useState(false);

  const fetchQuotes = useCallback(async () => {
    try {
      const { data } = await marketApi.quotes(ALL_SYMBOLS.join(','));
      const result = (data as { data: Record<string, QuoteData> }).data;
      setQuotes((prev) => ({ ...prev, ...result }));
    } catch (err) {
      console.error('TickerBar: failed to fetch quotes', err);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, pollInterval);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  const onMessage = useCallback((msg: { type: string; payload: unknown }) => {
    if (msg.type !== 'QUOTE') return;
    const { symbol, ltp } = msg.payload as { symbol: string; ltp: number };
    setQuotes((prev) => {
      const existing = prev[symbol];
      if (!existing) return prev;
      const base = existing.close || existing.ltp;
      const changePercent = base ? ((ltp - base) / base) * 100 : existing.changePercent;
      return { ...prev, [symbol]: { ...existing, ltp, changePercent } };
    });
  }, []);

  const pollInterval = usePollInterval();
  useWebSocket(onMessage, ALL_SYMBOLS);
  useInstrumentDirectory(ALL_SYMBOLS);

  const indices = INDICES.map((s) => quotes[s]).filter(Boolean) as QuoteData[];
  const stocks = WATCHLIST.map((s) => quotes[s]).filter(Boolean) as QuoteData[];

  const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();

  const items = [...indices, ...gainers, ...losers];

  if (items.length === 0) {
    return (
      <div className="fixed top-0 left-0 right-0 h-9 z-50 bg-gray-900 border-b border-gray-800 flex items-center px-5">
        <span className="text-xs text-gray-500">{timedOut ? 'Market Closed' : 'Loading market data…'}</span>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 h-9 z-50 bg-gray-900 border-b border-gray-800 overflow-hidden flex items-center">
      <div className="flex animate-marquee whitespace-nowrap">
        {[...items, ...items].map((q, idx) => {
          const positive = q.changePercent >= 0;
          return (
            <div key={`${q.symbol}-${idx}`} className="flex items-center gap-1.5 px-5 text-xs font-medium">
              <span className="text-gray-300">{symbolLabel(q.symbol)}</span>
              <span className="text-white">{q.ltp.toFixed(2)}</span>
              <span className={positive ? 'text-success' : 'text-danger'}>
                {positive ? '▲' : '▼'} {Math.abs(q.changePercent).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
