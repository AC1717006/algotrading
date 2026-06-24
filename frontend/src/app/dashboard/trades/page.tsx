'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/lib/api';
import { format } from 'date-fns';

// Fields match the Prisma Trade model exactly (side/qty/entryPrice/exitPrice/createdAt)
interface Trade {
  id: string;
  symbol: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  charges: number;
  mode: string;
  createdAt: string;
  closedAt: string | null;
}

interface Order {
  id: string;
  symbol: string;
  side: string;
  orderType: string;
  product: string;
  qty: number;
  price: number | null;
  status: string;
  mode: string;
  tag: string | null;
  placedAt: string;
}

function formatCurrency(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(value: string | null | undefined, pattern: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return format(d, pattern);
}

export default function TradesPage() {
  const [tab, setTab] = useState<'trades' | 'orders'>('trades');
  const [mode, setMode] = useState<'all' | 'PAPER' | 'LIVE'>('all');

  const {
    data: trades = [],
    isLoading: tradesLoading,
    error: tradesError,
  } = useQuery<Trade[]>({
    queryKey: ['trades', mode],
    queryFn: () =>
      tradingApi
        .getTrades(mode !== 'all' ? { mode } : {})
        // Backend returns: { success, data: { trades: [...], summary: {...} }, meta }
        // Extract the nested trades array — not data.data directly.
        .then((r) => (r.data as { data: { trades: Trade[] } }).data.trades ?? []),
    refetchInterval: 10_000,
  });

  const {
    data: orders = [],
    isLoading: ordersLoading,
    error: ordersError,
  } = useQuery<Order[]>({
    queryKey: ['orders', mode],
    queryFn: () =>
      tradingApi
        .getOrders(mode !== 'all' ? { mode } : {})
        .then((r) => (r.data as { data: Order[] }).data ?? []),
    refetchInterval: 10_000,
  });

  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winCount = trades.filter((t) => (t.pnl ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Trade History</h1>
        <div className="flex items-center gap-3">
          {/* Mode filter */}
          <div className="flex bg-gray-800 rounded-lg p-1 text-sm">
            {(['all', 'PAPER', 'LIVE'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-md transition-colors ${mode === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {m === 'all' ? 'All' : m}
              </button>
            ))}
          </div>
          {/* Tab */}
          <div className="flex bg-gray-800 rounded-lg p-1 text-sm">
            {(['trades', 'orders'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md capitalize transition-colors ${tab === t ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* P&L summary cards */}
      {tab === 'trades' && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Total Trades</p>
            <p className="text-xl font-bold text-white mt-1">{trades.length}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Realized P&amp;L</p>
            <p className={`text-xl font-bold mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(totalPnl)}
            </p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Win Rate</p>
            <p className="text-xl font-bold text-white mt-1">
              {trades.length ? `${((winCount / trades.length) * 100).toFixed(0)}%` : 'N/A'}
            </p>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {tab === 'trades' ? (
          tradesLoading ? (
            <p className="text-center text-gray-500 py-10">Loading trades…</p>
          ) : tradesError ? (
            <p className="text-center text-red-400 py-10">Unable to load trades. Please try again.</p>
          ) : trades.length === 0 ? (
            <p className="text-center text-gray-500 py-10">No trades yet</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="table-header text-left">Symbol</th>
                  <th className="table-header text-left">Side</th>
                  <th className="table-header text-right">Qty</th>
                  <th className="table-header text-right">Entry</th>
                  <th className="table-header text-right">Exit</th>
                  <th className="table-header text-right">P&amp;L</th>
                  <th className="table-header text-right">Charges</th>
                  <th className="table-header text-center">Mode</th>
                  <th className="table-header text-left">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/40">
                    <td className="table-cell font-medium text-white">{t.symbol ?? '—'}</td>
                    <td className="table-cell">
                      <span className={t.side === 'BUY' ? 'badge-green' : 'badge-red'}>{t.side ?? '—'}</span>
                    </td>
                    <td className="table-cell text-right">{t.qty ?? '—'}</td>
                    <td className="table-cell text-right">{formatCurrency(t.entryPrice)}</td>
                    <td className="table-cell text-right">{t.exitPrice != null ? formatCurrency(t.exitPrice) : '—'}</td>
                    <td className={`table-cell text-right font-medium ${(t.pnl ?? 0) > 0 ? 'text-green-400' : (t.pnl ?? 0) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                      {t.pnl != null ? formatCurrency(t.pnl) : '—'}
                    </td>
                    <td className="table-cell text-right text-gray-400">{formatCurrency(t.charges)}</td>
                    <td className="table-cell text-center">
                      <span className={t.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{t.mode ?? '—'}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-400">{formatTime(t.createdAt, 'dd MMM HH:mm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : ordersLoading ? (
          <p className="text-center text-gray-500 py-10">Loading orders…</p>
        ) : ordersError ? (
          <p className="text-center text-red-400 py-10">Unable to load orders. Please try again.</p>
        ) : orders.length === 0 ? (
          <p className="text-center text-gray-500 py-10">No orders yet</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="table-header text-left">Symbol</th>
                <th className="table-header text-left">Type</th>
                <th className="table-header text-left">Order</th>
                <th className="table-header text-left">Product</th>
                <th className="table-header text-right">Qty</th>
                <th className="table-header text-right">Price</th>
                <th className="table-header text-center">Status</th>
                <th className="table-header text-center">Mode</th>
                <th className="table-header text-left">Tag</th>
                <th className="table-header text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-800/40">
                  <td className="table-cell font-medium text-white">{o.symbol ?? '—'}</td>
                  <td className="table-cell">
                    <span className={o.side === 'BUY' ? 'badge-green' : 'badge-red'}>{o.side ?? '—'}</span>
                  </td>
                  <td className="table-cell text-gray-300">{o.orderType ?? '—'}</td>
                  <td className="table-cell text-gray-300">{o.product ?? '—'}</td>
                  <td className="table-cell text-right">{o.qty ?? '—'}</td>
                  <td className="table-cell text-right">{o.price ? formatCurrency(o.price) : 'MKT'}</td>
                  <td className="table-cell text-center">
                    <span className={o.status === 'COMPLETE' || o.status === 'FILLED' ? 'badge-green' : o.status === 'REJECTED' || o.status === 'CANCELLED' ? 'badge-red' : 'badge-yellow'}>
                      {o.status ?? '—'}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    <span className={o.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{o.mode ?? '—'}</span>
                  </td>
                  <td className="table-cell text-xs text-gray-500">{o.tag ?? '—'}</td>
                  <td className="table-cell text-xs text-gray-400">{formatTime(o.placedAt, 'dd MMM HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
