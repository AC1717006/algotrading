'use client';

import { useCallback, useEffect, useState } from 'react';
import { marketApi } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

const INDICES = [
  { key: 'NSE_INDEX|Nifty 50', label: 'NIFTY 50' },
  { key: 'NSE_INDEX|Nifty Bank', label: 'BANK NIFTY' },
  { key: 'BSE_INDEX|SENSEX', label: 'SENSEX' },
  { key: 'MCX_FO|466583', label: 'GOLD' },
  { key: 'MCX_FO|464150', label: 'SILVER' },
  { key: 'MCX_FO|499095', label: 'CRUDE OIL' },
];

const WATCHLIST = [
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
];

const SYMBOL_LABELS: Record<string, string> = {
  'NSE_EQ|INE009A01021': 'RELIANCE',
  'NSE_EQ|INE040A01034': 'HDFCBANK',
  'NSE_EQ|INE062A01020': 'SBIN',
  'NSE_EQ|INE090A01021': 'ICICIBANK',
  'NSE_EQ|INE467B01029': 'TCS',
  'NSE_EQ|INE148A01014': 'INFY',
  'NSE_EQ|INE669C01036': 'BAJFINANCE',
  'NSE_EQ|INE585B01010': 'MARUTI',
  'NSE_EQ|INE029A01011': 'ITC',
  'NSE_EQ|INE117A01022': 'WIPRO',
  'NSE_INDEX|Nifty 50': 'NIFTY 50',
  'NSE_INDEX|Nifty Bank': 'BANK NIFTY',
  'BSE_INDEX|SENSEX': 'SENSEX',
  'MCX_FO|466583': 'GOLD',
  'MCX_FO|464150': 'SILVER',
  'MCX_FO|499095': 'CRUDE OIL',
};

const ALL_SYMBOLS = [...INDICES.map((i) => i.key), ...WATCHLIST];

interface QuoteData {
  symbol: string;
  ltp: number;
  close: number;
  changePercent: number;
}

export function TickerBar() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});

  const fetchQuotes = useCallback(async () => {
    try {
      const { data } = await marketApi.quotes(ALL_SYMBOLS.join(','));
      const result = (data as { data: Record<string, QuoteData> }).data;
      setQuotes((prev) => ({ ...prev, ...result }));
    } catch {
      /* ignore — keep showing last known values */
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 5_000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

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

  useWebSocket(onMessage, ALL_SYMBOLS);

  const indices = INDICES.map((i) => quotes[i.key]).filter(Boolean) as QuoteData[];
  const stocks = WATCHLIST.map((s) => quotes[s]).filter(Boolean) as QuoteData[];

  const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();

  const items = [...indices, ...gainers, ...losers];

  if (items.length === 0) {
    return (
      <div className="fixed top-0 left-0 right-0 h-9 z-50 bg-gray-900 border-b border-gray-800 flex items-center px-5">
        <span className="text-xs text-gray-500">Loading market data…</span>
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
              <span className="text-gray-300">{SYMBOL_LABELS[q.symbol] ?? q.symbol}</span>
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
