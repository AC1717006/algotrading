'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { tradingApi, brokerApi } from '@/lib/api';
import { isMarketOpen, formatIstClock } from '@/lib/market';

const APP_VERSION = 'v1.0';

export function Header() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const { data: summary } = useQuery({
    queryKey: ['trading-summary'],
    queryFn: () => tradingApi.getSummary().then((r) => (r.data as { data: Record<string, unknown> }).data),
    refetchInterval: 10_000,
  });

  const { data: brokerStatus } = useQuery({
    queryKey: ['broker-status'],
    queryFn: () => brokerApi.validate().then((r) => (r.data as { data: { valid: boolean } }).data),
    refetchInterval: 60_000,
  });

  const modeMutation = useMutation({
    mutationFn: (mode: string) => tradingApi.setMode(mode),
    onSuccess: (_, mode) => {
      toast.success(`Switched to ${mode} mode`);
      qc.invalidateQueries({ queryKey: ['trading-summary'] });
    },
  });

  const mode = summary?.mode as string | undefined;
  const marketOpen = isMarketOpen(now);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-[var(--bg-primary)] border-b border-gray-800">
      {/* Left: logo + version */}
      <div className="flex items-center gap-2">
        <span className="font-bold text-white text-sm">AlgoTrader</span>
        <span className="text-xs text-[var(--text-muted)]">{APP_VERSION}</span>
      </div>

      {/* Center: live IST clock */}
      <div className="absolute left-1/2 -translate-x-1/2 text-sm font-medium text-[var(--text-secondary)] tabular-nums">
        {formatIstClock(now)} IST
      </div>

      {/* Right: market status, mode toggle, broker dot */}
      <div className="flex items-center gap-3">
        <span
          className={
            marketOpen
              ? 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-900 text-green-300'
              : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-900 text-red-300'
          }
        >
          {marketOpen ? 'Market Open' : 'Market Closed'}
        </span>

        <div className="flex bg-gray-800 rounded-lg p-1">
          {(['PAPER', 'LIVE'] as const).map((m) => (
            <button
              key={m}
              onClick={() => modeMutation.mutate(m)}
              disabled={modeMutation.isPending}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === m
                  ? m === 'LIVE'
                    ? 'bg-red-600 text-white'
                    : 'bg-brand-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]" title={brokerStatus?.valid ? 'Broker Connected' : 'Broker Disconnected'}>
          <span
            className={`w-2 h-2 rounded-full ${brokerStatus?.valid ? 'bg-green-500' : 'bg-red-500'}`}
          />
          Broker
        </div>
      </div>
    </header>
  );
}
