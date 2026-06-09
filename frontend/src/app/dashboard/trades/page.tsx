'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/lib/api';
import { format } from 'date-fns';

interface Trade {
  id: string;
  symbol: string;
  txType: string;
  quantity: number;
  price: number;
  value: number;
  pnl: number | null;
  charges: number;
  mode: string;
  executedAt: string;
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

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TradesPage() {
  const [tab, setTab] = useState<'trades' | 'orders'>('trades');
  const [mode, setMode] = useState<'all' | 'PAPER' | 'LIVE'>('all');

  const { data: trades } = useQuery({
    queryKey: ['trades', mode],
    queryFn: () =>
      tradingApi.getTrades(mode !== 'all' ? { mode } : {}).then((r) => (r.data as { data: Trade[] }).data),
    refetchInterval: 10_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders', mode],
    queryFn: () =>
      tradingApi.getOrders(mode !== 'all' ? { mode } : {}).then((r) => (r.data as { data: Order[] }).data),
    refetchInterval: 10_000,
  });

  const totalPnl = trades?.reduce((s, t) => s + (t.pnl ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Trade History</h1>
        <div className="flex items-center gap-3">
          {/* Mode filter */}
          <div className="flex bg-gray-800 rounded-lg p-1 text-sm">
            {(['all', 'PAPER', 'LIVE'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded-md transition-colors ${mode === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                {m === 'all' ? 'All' : m}
              </button>
            ))}
          </div>
          {/* Tab */}
          <div className="flex bg-gray-800 rounded-lg p-1 text-sm">
            {(['trades', 'orders'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded-md capitalize transition-colors ${tab === t ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* P&L summary */}
      {tab === 'trades' && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Total Trades</p>
            <p className="text-xl font-bold text-white mt-1">{trades?.length ?? 0}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Realized P&L</p>
            <p className={`text-xl font-bold mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(totalPnl)}
            </p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Win Rate</p>
            <p className="text-xl font-bold text-white mt-1">
              {trades?.length
                ? `${((trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length) * 100).toFixed(0)}%`
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {tab === 'trades' ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="table-header text-left">Symbol</th>
                <th className="table-header text-left">Side</th>
                <th className="table-header text-right">Qty</th>
                <th className="table-header text-right">Price</th>
                <th className="table-header text-right">Value</th>
                <th className="table-header text-right">P&L</th>
                <th className="table-header text-center">Mode</th>
                <th className="table-header text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {trades?.map((t) => (
                <tr key={t.id} className="hover:bg-gray-800/40">
                  <td className="table-cell font-medium text-white">{t.symbol}</td>
                  <td className="table-cell"><span className={t.txType === 'BUY' ? 'badge-green' : 'badge-red'}>{t.txType}</span></td>
                  <td className="table-cell text-right">{t.quantity}</td>
                  <td className="table-cell text-right">{formatCurrency(t.price)}</td>
                  <td className="table-cell text-right">{formatCurrency(t.value)}</td>
                  <td className={`table-cell text-right font-medium ${(t.pnl ?? 0) > 0 ? 'text-green-400' : (t.pnl ?? 0) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {t.pnl != null ? formatCurrency(t.pnl) : '—'}
                  </td>
                  <td className="table-cell text-center"><span className={t.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{t.mode}</span></td>
                  <td className="table-cell text-xs text-gray-400">{format(new Date(t.executedAt), 'dd MMM HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
              {orders?.map((o) => (
                <tr key={o.id} className="hover:bg-gray-800/40">
                  <td className="table-cell font-medium text-white">{o.symbol}</td>
                  <td className="table-cell"><span className={o.side === 'BUY' ? 'badge-green' : 'badge-red'}>{o.side}</span></td>
                  <td className="table-cell text-gray-300">{o.orderType}</td>
                  <td className="table-cell text-gray-300">{o.product}</td>
                  <td className="table-cell text-right">{o.qty}</td>
                  <td className="table-cell text-right">{o.price ? formatCurrency(o.price) : 'MKT'}</td>
                  <td className="table-cell text-center">
                    <span className={o.status === 'COMPLETE' ? 'badge-green' : o.status === 'REJECTED' || o.status === 'CANCELLED' ? 'badge-red' : 'badge-yellow'}>
                      {o.status}
                    </span>
                  </td>
                  <td className="table-cell text-center"><span className={o.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{o.mode}</span></td>
                  <td className="table-cell text-xs text-gray-500">{o.tag ?? '—'}</td>
                  <td className="table-cell text-xs text-gray-400">{format(new Date(o.placedAt), 'dd MMM HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!trades?.length && tab === 'trades' && <p className="text-center text-gray-500 py-10">No trades yet</p>}
        {!orders?.length && tab === 'orders' && <p className="text-center text-gray-500 py-10">No orders yet</p>}
      </div>
    </div>
  );
}
