'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TradeDetailDialog, type TradeDetail } from '@/components/TradeDetailDialog';
import { format } from 'date-fns';

// Matches backend trading.service.ts response (includes order + displaySymbol)
interface Trade {
  id: string;
  symbol: string;
  displaySymbol?: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  charges: number;
  stopLoss?: number | null;
  target?: number | null;
  mode: string;
  createdAt: string;
  closedAt: string | null;
  order?: {
    brokerOrderId?: string | null;
    strategyId?: string | null;
    tag?: string | null;
    strategy?: { name: string; type: string } | null;
  } | null;
}

interface Order {
  id: string;
  symbol: string;
  displaySymbol?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM HH:mm');
}

function sym(t: { displaySymbol?: string; symbol: string }) {
  return t.displaySymbol ?? t.symbol;
}

// ─── Flash hook — returns 'up' | 'down' | null on value change ───────────────
function useFlash(value: number) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    const dir = value > prev.current ? 'up' : 'down';
    prev.current = value;
    setFlash(dir);
    const t = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(t);
  }, [value]);

  return flash;
}

// ─── Live PnL cell with flash ─────────────────────────────────────────────────
function LivePnlCell({ pnl, livePnl }: { pnl: number | null; livePnl?: number }) {
  const effective = livePnl ?? pnl ?? 0;
  const flash = useFlash(effective);
  const color = effective > 0 ? 'text-green-400' : effective < 0 ? 'text-red-400' : 'text-gray-400';

  return (
    <span className={`font-medium transition-colors ${color} ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}>
      {fmt(effective)}
    </span>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────
function SummaryCards({
  trades,
  liveUnrealizedPnl,
}: {
  trades: Trade[];
  liveUnrealizedPnl: number;
}) {
  const closedTrades = trades.filter((t) => t.exitPrice != null);
  const realizedPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const flash = useFlash(liveUnrealizedPnl);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="card">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Closed Trades</p>
        <p className="text-xl font-bold text-white mt-1">{closedTrades.length}</p>
      </div>
      <div className="card">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Realized P&L</p>
        <p className={`text-xl font-bold mt-1 ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {fmt(realizedPnl)}
        </p>
      </div>
      <div className="card">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Open P&L (Live)</p>
        <p className={`text-xl font-bold mt-1 ${liveUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'} ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''} animate-count`}>
          {fmt(liveUnrealizedPnl)}
        </p>
      </div>
      <div className="card">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Win Rate</p>
        <p className="text-xl font-bold text-white mt-1">
          {closedTrades.length ? `${((wins / closedTrades.length) * 100).toFixed(0)}%` : 'N/A'}
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TradesPage() {
  const [tab, setTab] = useState<'trades' | 'orders'>('trades');
  const [mode, setMode] = useState<'all' | 'PAPER' | 'LIVE'>('all');
  const [selectedTrade, setSelectedTrade] = useState<TradeDetail | null>(null);
  const [liveUnrealizedPnl, setLiveUnrealizedPnl] = useState(0);
  // Map of instrument-key → ltp for open-position live MTM
  const [liveQuotes, setLiveQuotes] = useState<Record<string, number>>({});

  // ─── Data fetching ──────────────────────────────────────────────────────────
  const {
    data: trades = [],
    isLoading: tradesLoading,
    error: tradesError,
  } = useQuery<Trade[]>({
    queryKey: ['trades', mode],
    queryFn: () =>
      tradingApi
        .getTrades(mode !== 'all' ? { mode } : {})
        .then((r) => (r.data as { data: { trades: Trade[] } }).data.trades ?? []),
    refetchInterval: 15_000,
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
    refetchInterval: 15_000,
  });

  // ─── Live WebSocket ─────────────────────────────────────────────────────────
  const onWsMessage = useCallback((msg: { type: string; payload: unknown }) => {
    if (msg.type === 'MTM_UPDATE') {
      const p = msg.payload as { unrealizedPnl: number; quotes?: Record<string, number> };
      setLiveUnrealizedPnl(p.unrealizedPnl);
      if (p.quotes) setLiveQuotes(p.quotes);
    }
    if (msg.type === 'QUOTE') {
      const q = msg.payload as { symbol: string; ltp: number };
      setLiveQuotes((prev) => ({ ...prev, [q.symbol]: q.ltp }));
    }
  }, []);

  useWebSocket(onWsMessage);

  // ─── Compute live PnL for an open trade ────────────────────────────────────
  const getLivePnl = useCallback(
    (trade: Trade) => {
      if (trade.exitPrice != null) return trade.pnl; // closed — static
      // Try to look up LTP from live quotes
      const ltp = liveQuotes[trade.symbol] ?? liveQuotes[trade.displaySymbol ?? ''];
      if (!ltp) return null;
      return trade.side === 'BUY'
        ? (ltp - trade.entryPrice) * trade.qty
        : (trade.entryPrice - ltp) * trade.qty;
    },
    [liveQuotes],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header + filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Trade History</h1>
          <p className="text-xs text-gray-500 mt-0.5">Click any row for full analytics</p>
        </div>
        <div className="flex items-center gap-3">
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

      {/* Summary cards — trades tab only */}
      {tab === 'trades' && (
        <SummaryCards trades={trades} liveUnrealizedPnl={liveUnrealizedPnl} />
      )}

      {/* Main table */}
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
                  <th className="table-header text-center">Status</th>
                  <th className="table-header text-left">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {trades.map((t) => {
                  const livePnl = getLivePnl(t);
                  const isOpen = t.exitPrice == null;
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-800/40 cursor-pointer transition-colors"
                      onClick={() => setSelectedTrade(t as TradeDetail)}
                    >
                      <td className="table-cell font-semibold text-white">
                        {sym(t)}
                        {t.order?.strategy && (
                          <span className="ml-2 text-xs text-gray-500">{t.order.strategy.type}</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <span className={t.side === 'BUY' ? 'badge-green' : 'badge-red'}>{t.side}</span>
                      </td>
                      <td className="table-cell text-right">{t.qty}</td>
                      <td className="table-cell text-right">{fmt(t.entryPrice)}</td>
                      <td className="table-cell text-right">{t.exitPrice != null ? fmt(t.exitPrice) : '—'}</td>
                      <td className="table-cell text-right">
                        <LivePnlCell pnl={t.pnl} livePnl={livePnl ?? undefined} />
                      </td>
                      <td className="table-cell text-right text-gray-500">{fmt(t.charges)}</td>
                      <td className="table-cell text-center">
                        <span className={t.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{t.mode}</span>
                      </td>
                      <td className="table-cell text-center">
                        <span className={isOpen ? 'badge-yellow' : 'badge-green'}>{isOpen ? 'OPEN' : 'CLOSED'}</span>
                      </td>
                      <td className="table-cell text-xs text-gray-400">{fmtTime(t.createdAt)}</td>
                    </tr>
                  );
                })}
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
                <th className="table-header text-left">Side</th>
                <th className="table-header text-left">Type</th>
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
                  <td className="table-cell font-semibold text-white">{sym(o)}</td>
                  <td className="table-cell">
                    <span className={o.side === 'BUY' ? 'badge-green' : 'badge-red'}>{o.side}</span>
                  </td>
                  <td className="table-cell text-gray-300">{o.orderType ?? '—'}</td>
                  <td className="table-cell text-gray-300">{o.product ?? '—'}</td>
                  <td className="table-cell text-right">{o.qty}</td>
                  <td className="table-cell text-right">{o.price ? fmt(o.price) : 'MKT'}</td>
                  <td className="table-cell text-center">
                    <span className={
                      o.status === 'COMPLETE' || o.status === 'FILLED' ? 'badge-green'
                        : o.status === 'REJECTED' || o.status === 'CANCELLED' ? 'badge-red'
                          : 'badge-yellow'
                    }>
                      {o.status}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    <span className={o.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{o.mode}</span>
                  </td>
                  <td className="table-cell text-xs text-gray-500">{o.tag ?? '—'}</td>
                  <td className="table-cell text-xs text-gray-400">{fmtTime(o.placedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Trade detail popup */}
      {selectedTrade && (
        <TradeDetailDialog trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}
    </div>
  );
}
