'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { marketApi } from '@/lib/api';
import { symbolLabel } from '@/lib/symbols';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTERVALS = [
  { key: '1m', label: '1m', minutes: 1 },
  { key: '5m', label: '5m', minutes: 5 },
  { key: '15m', label: '15m', minutes: 15 },
  { key: '1h', label: '1h', minutes: 60 },
  { key: '1d', label: '1d', minutes: 0 },
] as const;

type IntervalKey = (typeof INTERVALS)[number]['key'];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1 || candles.length === 0) return candles;
  const bucketMs = minutes * 60_000;
  const buckets = new Map<number, Candle>();

  for (const c of candles) {
    const bucketStart = Math.floor(c.timestamp / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { ...c, timestamp: bucketStart });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function toCsv(candles: Candle[]): string {
  const header = 'timestamp,open,high,low,close,volume';
  const rows = candles.map((c) => `${new Date(c.timestamp).toISOString()},${c.open},${c.high},${c.low},${c.close},${c.volume}`);
  return [header, ...rows].join('\n');
}

interface HistoricalChartProps {
  symbol?: string;
  symbols: string[];
  onSymbolChange?: (symbol: string) => void;
}

export function HistoricalChart({ symbol, symbols, onSymbolChange }: HistoricalChartProps) {
  const [rawCandles, setRawCandles] = useState<Candle[]>([]);
  const [dayCandles, setDayCandles] = useState<Candle[]>([]);
  const [interval, setInterval] = useState<IntervalKey>('5m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Fetch 90-day 1-minute history when symbol changes
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setRawCandles([]);
    setDayCandles([]);

    marketApi
      .history({ symbol, interval: '1minute', days: 90 })
      .then(({ data }) => {
        const result = (data as { data: { candles: Candle[] } }).data;
        setRawCandles(result.candles ?? []);
      })
      .catch(() => {
        setError('Could not load historical data. Upstox may not provide 1-minute data for this symbol outside market hours.');
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  // Fetch daily candles when 1d interval selected
  useEffect(() => {
    if (!symbol || interval !== '1d') return;
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 90);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    marketApi
      .candles({ symbol, interval: 'day', from: fmt(from), to: fmt(to) })
      .then(({ data }) => {
        const candles = (data as { data: Candle[] }).data;
        setDayCandles(candles ?? []);
      })
      .catch(() => {
        setError('Could not load daily historical data for this symbol.');
      });
  }, [symbol, interval]);

  const displayCandles = useMemo(() => {
    if (interval === '1d') return dayCandles;
    const intervalConfig = INTERVALS.find((i) => i.key === interval)!;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const sliced = rawCandles.filter((c) => c.timestamp >= cutoff);
    return aggregateCandles(sliced, intervalConfig.minutes);
  }, [rawCandles, dayCandles, interval]);

  const stats = useMemo(() => {
    if (displayCandles.length === 0 || rawCandles.length === 0) return null;
    const first = displayCandles[0];
    const last = displayCandles[displayCandles.length - 1];
    const high = Math.max(...displayCandles.map((c) => c.high));
    const low = Math.min(...displayCandles.map((c) => c.low));

    const totalVolume = rawCandles.reduce((sum, c) => sum + c.volume, 0);
    const avgVolume = totalVolume / rawCandles.length;

    const threeMonthHigh = Math.max(...rawCandles.map((c) => c.high));
    const threeMonthLow = Math.min(...rawCandles.map((c) => c.low));
    const threeMonthReturn = ((rawCandles[rawCandles.length - 1].close - rawCandles[0].open) / rawCandles[0].open) * 100;

    return {
      open: first.open,
      high,
      low,
      last: last.close,
      avgVolume,
      threeMonthReturn,
      threeMonthHigh,
      threeMonthLow,
    };
  }, [displayCandles, rawCandles]);

  // Render chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    if (displayCandles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: '#2A2D3E' },
        horzLines: { color: '#2A2D3E' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });
    candleSeries.setData(
      displayCandles.map((c) => ({
        time: (c.timestamp / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      },
      1,
    );
    chart.panes()[1]?.setHeight(100);
    volumeSeries.setData(
      displayCandles.map((c) => ({
        time: (c.timestamp / 1000) as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#10B98166' : '#EF444466',
      })),
    );

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [displayCandles]);

  const handleExportCsv = () => {
    if (rawCandles.length === 0 || !symbol) return;
    const csv = toCsv(interval === '1d' ? dayCandles : rawCandles);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbolLabel(symbol)}_${interval}_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!symbol) {
    return (
      <div className="card">
        <h2 className="stat-label mb-4">Historical Data</h2>
        <p className="text-sm text-gray-500 py-12 text-center">Select a symbol from the Watchlist to view its chart</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="stat-label">Historical Data</h2>
          <select
            value={symbol}
            onChange={(e) => onSymbolChange?.(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {symbolLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800 rounded-lg p-1">
            {INTERVALS.map((i) => (
              <button
                key={i.key}
                onClick={() => setInterval(i.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  interval === i.key ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
          <button onClick={handleExportCsv} className="btn-ghost text-xs px-3 py-1.5">
            📥 CSV
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500 py-12 text-center">Loading historical data…</p>}
      {error && <p className="text-sm text-red-400 py-12 text-center">{error}</p>}

      {!loading && !error && (
        <>
          <div ref={chartContainerRef} className="w-full" />
          {stats && (
            <div className="mt-4 pt-4 border-t border-gray-800 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-secondary)]">
              <span>Open: <span className="text-white font-medium">{stats.open.toFixed(2)}</span></span>
              <span>High: <span className="text-white font-medium">{stats.high.toFixed(2)}</span></span>
              <span>Low: <span className="text-white font-medium">{stats.low.toFixed(2)}</span></span>
              <span>Last: <span className="text-white font-medium">{stats.last.toFixed(2)}</span></span>
              <span>Avg Volume: <span className="text-white font-medium">{stats.avgVolume.toFixed(0)}/min</span></span>
              <span>3M Return: <span className={stats.threeMonthReturn >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>{stats.threeMonthReturn.toFixed(2)}%</span></span>
              <span>3M High: <span className="text-white font-medium">{stats.threeMonthHigh.toFixed(2)}</span></span>
              <span>3M Low: <span className="text-white font-medium">{stats.threeMonthLow.toFixed(2)}</span></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
