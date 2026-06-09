'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { settingsApi, brokerApi, tradingApi } from '@/lib/api';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [newToken, setNewToken] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.list().then((r) => (r.data as { data: Record<string, string> }).data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsApi.update(key, value),
    onSuccess: () => { toast.success('Setting updated'); qc.invalidateQueries({ queryKey: ['settings'] }); setEditKey(null); },
    onError: () => toast.error('Failed to update setting'),
  });

  const tokenMutation = useMutation({
    mutationFn: (token: string) => brokerApi.updateToken(token),
    onSuccess: () => { toast.success('Upstox token updated'); setNewToken(''); },
    onError: () => toast.error('Failed to update token'),
  });

  const resetCBMutation = useMutation({
    mutationFn: () => tradingApi.resetCircuitBreaker(),
    onSuccess: () => toast.success('Circuit breaker reset'),
  });

  const DISPLAY_KEYS: Record<string, string> = {
    trading_mode: 'Trading Mode',
    paper_balance: 'Paper Balance (₹)',
    max_daily_loss_pct: 'Max Daily Loss %',
    max_trades_per_day: 'Max Trades / Day',
    max_position_size_pct: 'Max Position Size %',
    circuit_breaker_loss_pct: 'Circuit Breaker Loss %',
    telegram_enabled: 'Telegram Alerts',
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* Risk & Trading Settings */}
      <div className="card space-y-1">
        <h2 className="text-sm font-semibold text-white mb-4">Risk & Trading</h2>
        {Object.entries(DISPLAY_KEYS).map(([key, label]) => {
          const val = settings?.[key] ?? '';
          const isEditing = editKey === key;
          return (
            <div key={key} className="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0">
              <div>
                <p className="text-sm text-gray-200">{label}</p>
                <p className="text-xs text-gray-500 font-mono">{key}</p>
              </div>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="w-32 px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button onClick={() => updateMutation.mutate({ key, value: editVal })} disabled={updateMutation.isPending} className="btn-primary text-xs py-1.5 px-3">Save</button>
                  <button onClick={() => setEditKey(null)} className="btn-ghost text-xs py-1.5 px-3">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-brand-400">{val}</span>
                  <button onClick={() => { setEditKey(key); setEditVal(val); }} className="text-xs text-gray-500 hover:text-white transition-colors">Edit</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Broker Token */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-white">Upstox Access Token</h2>
        <p className="text-xs text-gray-400">Paste your Upstox access token below. Generate it from the Upstox Developer Console or via OAuth login.</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="ey..."
            className="flex-1 px-3.5 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button onClick={() => tokenMutation.mutate(newToken)} disabled={!newToken || tokenMutation.isPending} className="btn-primary">
            {tokenMutation.isPending ? 'Saving...' : 'Update'}
          </button>
        </div>
      </div>

      {/* Emergency Controls */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-white">Emergency Controls</h2>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-gray-200">Reset Circuit Breaker</p>
            <p className="text-xs text-gray-500">Allows new orders after a circuit breaker event. Use with caution.</p>
          </div>
          <button onClick={() => resetCBMutation.mutate()} disabled={resetCBMutation.isPending} className="btn-danger text-sm">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
