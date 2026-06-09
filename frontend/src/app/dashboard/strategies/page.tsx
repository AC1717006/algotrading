'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { strategyApi } from '@/lib/api';

interface Strategy {
  id: string;
  name: string;
  type: string;
  symbol: string;
  timeframe: string;
  isActive: boolean;
  mode: string;
  parameters: Record<string, unknown>;
  riskSettings: Record<string, unknown>;
}

export default function StrategiesPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Strategy | null>(null);

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyApi.list().then((r) => (r.data as { data: Strategy[] }).data),
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
    </div>
  );
}
