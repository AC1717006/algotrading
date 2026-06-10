'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { strategyApi, marketApi } from '@/lib/api';

interface Strategy {
  id: string;
  name: string;
  type: string;
  symbol: string;
  watchedSymbols: string[];
  exchange: string;
  timeframe: string;
  isActive: boolean;
  mode: string;
  parameters: Record<string, unknown>;
  riskSettings: Record<string, unknown>;
}

interface MoverQuote {
  symbol: string;
  ltp: number;
  changePercent: number;
}

export default function StrategiesPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [newSymbol, setNewSymbol] = useState('');

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyApi.list().then((r) => (r.data as { data: Strategy[] }).data),
  });

  const { data: topMovers } = useQuery({
    queryKey: ['top-movers'],
    queryFn: () => marketApi.topMovers().then((r) => (r.data as { data: { gainers: MoverQuote[]; losers: MoverQuote[] } }).data),
    refetchInterval: 10_000,
  });

  const enableMutation = useMutation({
    mutationFn: (id: string) => strategyApi.enable(id),
    onSuccess: () => { toast.success('Strategy enabled'); qc.invalidateQueries({ queryKey: ['strategies'] }); },
    onError: () => toast.error('Failed to enable strategy'),
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => strategyApi.disable(id),
    onSuccess: () => { toast.success('Strategy disabled'); qc.invalidateQueries({ queryKey: ['strategies'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => strategyApi.delete(id),
    onSuccess: () => { toast.success('Strategy deleted'); qc.invalidateQueries({ queryKey: ['strategies'] }); setSelected(null); },
  });

  const watchedSymbolsMutation = useMutation({
    mutationFn: ({ id, watchedSymbols }: { id: string; watchedSymbols: string[] }) =>
      strategyApi.update(id, { watchedSymbols }),
    onSuccess: (_data, variables) => {
      toast.success('Watchlist updated');
      qc.invalidateQueries({ queryKey: ['strategies'] });
      setSelected((prev) => (prev && prev.id === variables.id ? { ...prev, watchedSymbols: variables.watchedSymbols } : prev));
      setNewSymbol('');
    },
    onError: () => toast.error('Failed to update watchlist'),
  });

  const addSymbol = (strategy: Strategy) => {
    const sym = newSymbol.trim();
    if (!sym) return;
    if (strategy.watchedSymbols?.includes(sym)) { toast.error('Symbol already in watchlist'); return; }
    watchedSymbolsMutation.mutate({ id: strategy.id, watchedSymbols: [...(strategy.watchedSymbols ?? []), sym] });
  };

  const removeSymbol = (strategy: Strategy, sym: string) => {
    watchedSymbolsMutation.mutate({ id: strategy.id, watchedSymbols: (strategy.watchedSymbols ?? []).filter((s) => s !== sym) });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Strategies</h1>
        <span className="badge-blue">{strategies?.filter((s) => s.isActive).length ?? 0} running</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {strategies?.map((strategy) => (
          <div key={strategy.id} className={`card transition-all ${selected?.id === strategy.id ? 'ring-1 ring-brand-500' : ''}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-white text-sm">{strategy.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{strategy.type} · {strategy.timeframe} · {strategy.exchange ?? 'NSE'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={strategy.mode === 'LIVE' ? 'badge-red' : 'badge-blue'}>{strategy.mode}</span>
                <span className={strategy.isActive ? 'badge-green' : 'badge-yellow'}>{strategy.isActive ? 'ON' : 'OFF'}</span>
              </div>
            </div>

            <div className="text-xs text-gray-400 mb-3">
              Symbol: {strategy.symbol}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => strategy.isActive ? disableMutation.mutate(strategy.id) : enableMutation.mutate(strategy.id)}
                className={strategy.isActive ? 'btn-danger text-xs py-1.5 px-3' : 'btn-primary text-xs py-1.5 px-3'}
                disabled={enableMutation.isPending || disableMutation.isPending}
              >
                {strategy.isActive ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => setSelected(selected?.id === strategy.id ? null : strategy)} className="btn-ghost text-xs py-1.5 px-3">
                Details
              </button>
              <button onClick={() => { if (confirm('Delete this strategy?')) deleteMutation.mutate(strategy.id); }} className="ml-auto text-xs text-gray-500 hover:text-red-400 transition-colors">
                Delete
              </button>
            </div>

            {/* Parameters panel */}
            {selected?.id === strategy.id && (
              <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-500 mb-1.5">Parameters</p>
                  {Object.entries(strategy.parameters).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-0.5">
                      <span className="text-gray-400">{k}</span>
                      <span className="text-white font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-gray-500 mb-1.5">Risk Settings</p>
                  {Object.entries(strategy.riskSettings).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-0.5">
                      <span className="text-gray-400">{k}</span>
                      <span className="text-white font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>

                <div className="col-span-2">
                  <p className="text-gray-500 mb-1.5">Watched Symbols</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(strategy.watchedSymbols ?? []).length === 0 && (
                      <span className="text-gray-600">No additional symbols tracked.</span>
                    )}
                    {(strategy.watchedSymbols ?? []).map((sym) => (
                      <span key={sym} className="inline-flex items-center gap-1.5 bg-gray-800 text-gray-300 font-mono px-2 py-1 rounded-md">
                        {sym}
                        <button onClick={() => removeSymbol(strategy, sym)} className="text-gray-500 hover:text-red-400">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      placeholder="e.g. NSE_EQ|INE002A01018"
                      className="flex-1 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white font-mono text-xs placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <button
                      onClick={() => addSymbol(strategy)}
                      disabled={watchedSymbolsMutation.isPending}
                      className="btn-primary text-xs py-1.5 px-3"
                    >
                      Add Symbol
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {!strategies?.length && (
          <div className="col-span-2 card text-center py-12">
            <p className="text-gray-500">No strategies configured yet.</p>
            <p className="text-xs text-gray-600 mt-1">Use the API to create strategies.</p>
          </div>
        )}
      </div>

      {/* Top Movers Watchlist */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-3">Top Movers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-2">Top Gainers</p>
            <div className="space-y-1">
              {topMovers?.gainers.length ? topMovers.gainers.map((q) => (
                <div key={q.symbol} className="flex justify-between text-xs py-1">
                  <span className="text-gray-300 font-mono truncate">{q.symbol}</span>
                  <span className="text-white">{q.ltp.toFixed(2)}</span>
                  <span className="text-success">+{q.changePercent.toFixed(2)}%</span>
                </div>
              )) : <p className="text-xs text-gray-600">No data</p>}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Top Losers</p>
            <div className="space-y-1">
              {topMovers?.losers.length ? topMovers.losers.map((q) => (
                <div key={q.symbol} className="flex justify-between text-xs py-1">
                  <span className="text-gray-300 font-mono truncate">{q.symbol}</span>
                  <span className="text-white">{q.ltp.toFixed(2)}</span>
                  <span className="text-danger">{q.changePercent.toFixed(2)}%</span>
                </div>
              )) : <p className="text-xs text-gray-600">No data</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
