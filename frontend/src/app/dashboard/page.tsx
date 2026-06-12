'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { tradingApi } from '@/lib/api';
import { StatCard } from '@/components/StatCard';
import { useWebSocket } from '@/hooks/useWebSocket';

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const [liveQuotes, setLiveQuotes] = useState<Record<string, number>>({});

  const { data: summary } = useQuery({
    queryKey: ['trading-summary'],
    queryFn: () => tradingApi.getSummary().then((r) => (r.data as { data: Record<string, unknown> }).data),
    refetchInterval: 10_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['open-orders'],
    queryFn: () => tradingApi.getOrders({ status: 'OPEN' }).then((r) => (r.data as { data: unknown[] }).data),
    refetchInterval: 5_000,
  });

  const onWsMessage = useCallback((msg: { type: string; payload: unknown }) => {
    if (msg.type === 'QUOTE') {
      const q = msg.payload as { symbol: string; ltp: number };
      setLiveQuotes((prev) => ({ ...prev, [q.symbol]: q.ltp }));
    }
    if (msg.type === 'ORDER_UPDATE') {
      qc.invalidateQueries({ queryKey: ['open-orders'] });
    }
  }, [qc]);

  useWebSocket(onWsMessage);

  const paperBalance = summary?.paperBalance as number | undefined;
  const dailyPnl = summary?.dailyPnl as number | undefined;
  const unrealizedPnl = summary?.unrealizedPnl as number | undefined;
  const openPositions = summary?.openPositions as number | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400 mt-0.5">Real-time trading dashboard</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Paper Balance"
          icon="💰"
          accent="blue"
          value={formatCurrency(paperBalance ?? 0)}
          subtext="Available cash"
        />
        <StatCard
          title="Daily P&L"
          icon="📈"
          accent={(dailyPnl ?? 0) > 0 ? 'green' : (dailyPnl ?? 0) < 0 ? 'red' : 'neutral'}
          value={formatCurrency(dailyPnl ?? 0)}
          positive={(dailyPnl ?? 0) > 0}
          negative={(dailyPnl ?? 0) < 0}
          subtext="Realized today"
        />
        <StatCard
          title="Open P&L"
          icon="📊"
          accent="neutral"
          value={formatCurrency(unrealizedPnl ?? 0)}
          positive={(unrealizedPnl ?? 0) > 0}
          negative={(unrealizedPnl ?? 0) < 0}
          subtext="Unrealized"
        />
        <StatCard
          title="Open Positions"
          icon="🔢"
          accent="blue"
          value={openPositions ?? 0}
          subtext="Active positions"
        />
      </div>

      {/* Open Orders */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Open Orders</h2>
        {!orders?.length ? (
          <p className="text-sm text-gray-500 py-6 text-center">No open orders</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="table-header text-left">Symbol</th>
                  <th className="table-header text-left">Type</th>
                  <th className="table-header text-right">Qty</th>
                  <th className="table-header text-right">Price</th>
                  <th className="table-header text-center">Mode</th>
                  <th className="table-header text-center">Status</th>
                  <th className="table-header text-left">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {(orders as Array<Record<string, unknown>>).map((o) => (
                  <tr key={o.id as string} className="hover:bg-gray-800/50">
                    <td className="table-cell font-medium text-white">{o.symbol as string}</td>
                    <td className="table-cell">
                      <span className={o.side === 'BUY' ? 'badge-green' : 'badge-red'}>
                        {o.side as string}
                      </span>
                    </td>
                    <td className="table-cell text-right">{o.qty as number}</td>
                    <td className="table-cell text-right">{o.price ? formatCurrency(o.price as number) : 'MKT'}</td>
                    <td className="table-cell text-center">
                      <span className={o.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{o.mode as string}</span>
                    </td>
                    <td className="table-cell text-center">
                      <span className="badge-yellow">{o.status as string}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-500">
                      {new Date(o.placedAt as string).toLocaleTimeString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live Quotes */}
      {Object.keys(liveQuotes).length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4">Live Feed</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(liveQuotes).map(([symbol, ltp]) => (
              <div key={symbol} className="bg-gray-800 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 truncate">{symbol.split('|').pop()}</p>
                <p className="text-sm font-bold text-white">{formatCurrency(ltp)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
