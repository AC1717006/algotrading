'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { marketApi } from '@/lib/api';
import { DEFAULT_WATCHLIST, INSTRUMENT_DIRECTORY, isIndexSymbol, symbolLabel, getInstrumentKey } from '@/lib/instrument-mapping';
import type { InstrumentInfo } from '@/lib/instrument-mapping';
import { isMarketOpen, formatIstClock } from '@/lib/market';
import { Modal } from '@/components/Modal';

const STORAGE_KEY = 'watchlist_symbols';

interface QuoteRow {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

function formatNumber(symbol: string, value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  const formatted = value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isIndexSymbol(symbol) ? formatted : `₹${formatted}`;
}

interface WatchlistProps {
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
  onSymbolsChange?: (symbols: string[]) => void;
}

export function Watchlist({ selectedSymbol, onSelectSymbol, onSymbolsChange }: WatchlistProps) {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [apiResults, setApiResults] = useState<InstrumentInfo[]>([]);

  // Load persisted symbols
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) setSymbols(parsed);
      } catch {
        // ignore malformed storage
      }
    }
  }, []);

  // Persist symbols
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    onSymbolsChange?.(symbols);
  }, [symbols, onSymbolsChange]);

  const fetchQuotes = useCallback(async () => {
    if (symbols.length === 0) return;
    try {
      const { data } = await marketApi.quotes(symbols.join(','));
      const result = (data as { data: Record<string, QuoteRow> }).data;
      setQuotes((prev) => ({ ...prev, ...result }));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Watchlist: failed to fetch quotes', err);
    }
  }, [symbols]);

  useEffect(() => {
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 5_000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  const removeSymbol = (symbol: string) => {
    setSymbols((prev) => prev.filter((s) => s !== symbol));
  };

  const addSymbol = (symbol: string) => {
    const trimmed = symbol.trim();
    if (!trimmed) return;
    const key = getInstrumentKey(trimmed);
    setSymbols((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setModalOpen(false);
    setSearch('');
    setManualKey('');
  };

  // Debounced search against the NSE instrument directory (1500+ MIS-eligible stocks)
  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setApiResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await marketApi.searchInstruments(term);
        setApiResults((data as { data: InstrumentInfo[] }).data ?? []);
      } catch (err) {
        console.error('Watchlist: instrument search failed', err);
        setApiResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const localResults = search.trim()
    ? INSTRUMENT_DIRECTORY.filter(
        (i) =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          i.key.toLowerCase().includes(search.toLowerCase()),
      )
    : [];

  const searchResults = [
    ...localResults,
    ...apiResults.filter((i) => !localResults.some((l) => l.key === i.key)),
  ];

  const marketOpen = isMarketOpen();

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="stat-label">Watchlist</h2>
        <div className="flex items-center gap-2">
          {!marketOpen && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-900 text-yellow-300">
              Market Closed — Showing LTP
            </span>
          )}
          <button onClick={() => setModalOpen(true)} className="btn-ghost text-xs px-3 py-1.5">
            + Add Symbol
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="table-header text-left">Symbol</th>
              <th className="table-header text-right">LTP</th>
              <th className="table-header text-right">Change</th>
              <th className="table-header text-right">% Chg</th>
              <th className="table-header text-right">High</th>
              <th className="table-header text-right">Low</th>
              <th className="table-header text-center w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {symbols.map((symbol) => {
              const q = quotes[symbol];
              const positive = (q?.changePercent ?? 0) >= 0;
              const isSelected = symbol === selectedSymbol;
              return (
                <tr
                  key={symbol}
                  onClick={() => onSelectSymbol?.(symbol)}
                  className={clsx(
                    'group cursor-pointer hover:bg-gray-800/50 transition-colors',
                    isSelected && 'bg-gray-800/70',
                  )}
                >
                  <td className="table-cell font-medium text-white">{symbolLabel(symbol)}</td>
                  <td className="table-cell text-right tabular-nums">{formatNumber(symbol, q?.ltp)}</td>
                  <td
                    className={clsx(
                      'table-cell text-right tabular-nums border-l-2',
                      positive ? 'text-green-400 border-l-green-500' : 'text-red-400 border-l-red-500',
                    )}
                  >
                    {q ? `${positive ? '+' : ''}${q.change.toFixed(2)}` : '—'}
                  </td>
                  <td className={clsx('table-cell text-right tabular-nums', positive ? 'text-green-400' : 'text-red-400')}>
                    {q ? `${positive ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
                  </td>
                  <td className="table-cell text-right tabular-nums text-gray-400">{formatNumber(symbol, q?.high)}</td>
                  <td className="table-cell text-right tabular-nums text-gray-400">{formatNumber(symbol, q?.low)}</td>
                  <td className="table-cell text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSymbol(symbol);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        {lastUpdated && <span>Last updated: {formatIstClock(lastUpdated)} IST</span>}
        <span className="text-green-500">●</span>
        <span>Auto-refreshing every 5s</span>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add Symbol to Watchlist">
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search e.g. INFY, TCS"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {searchResults.map((i) => (
                <button
                  key={i.key}
                  onClick={() => addSymbol(i.key)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <span className="text-white font-medium">{i.label}</span>{' '}
                  <span className="text-gray-500">— {i.key}</span>
                </button>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-2">Or enter an instrument key directly:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                placeholder="e.g. NSE_EQ|INE002A01018"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <button onClick={() => addSymbol(manualKey)} className="btn-primary text-sm px-4">
                Add
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
