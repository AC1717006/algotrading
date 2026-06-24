'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format, formatDistanceStrict } from 'date-fns';

// Matches what trading.service.ts now returns (with order relation + displaySymbol)
export interface TradeDetail {
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

interface Props {
  trade: TradeDetail;
  onClose: () => void;
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtTime(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy, HH:mm:ss');
}

function holdingDuration(open: string, close: string | null) {
  if (!close) return 'Open';
  try {
    return formatDistanceStrict(new Date(open), new Date(close));
  } catch {
    return '—';
  }
}

function Row({ label, value, valueClass = '' }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800/60 last:border-0">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-medium text-right ${valueClass}`}>{value}</span>
    </div>
  );
}

export function TradeDetailDialog({ trade, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const displayName = trade.displaySymbol ?? trade.symbol;
  const isClosed = trade.exitPrice != null;
  const grossPnl = isClosed
    ? trade.side === 'SELL'
      ? (trade.exitPrice! - trade.entryPrice) * trade.qty
      : (trade.entryPrice - trade.exitPrice!) * trade.qty
    : null;
  const netPnl = trade.pnl;
  const profitPct = grossPnl != null && trade.entryPrice > 0
    ? ((grossPnl / (trade.entryPrice * trade.qty)) * 100).toFixed(2)
    : null;

  const pnlColor = (netPnl ?? 0) > 0 ? 'text-green-400' : (netPnl ?? 0) < 0 ? 'text-red-400' : 'text-gray-400';

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Trade Details"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-bold text-white">{displayName}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{trade.symbol}</p>
            </div>
            <span className={trade.side === 'BUY' ? 'badge-green' : 'badge-red'}>{trade.side}</span>
            <span className={trade.mode === 'PAPER' ? 'badge-blue' : 'badge-red'}>{trade.mode}</span>
            <span className={isClosed ? 'badge-green' : 'badge-yellow'}>{isClosed ? 'CLOSED' : 'OPEN'}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* PnL highlight */}
          {isClosed && (
            <div className={`rounded-lg p-4 text-center ${(netPnl ?? 0) >= 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Net P&L</p>
              <p className={`text-2xl font-bold ${pnlColor}`}>{fmt(netPnl)}</p>
              {profitPct && (
                <p className={`text-sm mt-1 ${pnlColor}`}>{(netPnl ?? 0) >= 0 ? '+' : ''}{profitPct}%</p>
              )}
            </div>
          )}

          {/* Identifiers */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Identifiers</p>
            <Row label="Trade ID" value={<span className="text-xs font-mono text-gray-400 truncate max-w-[200px] block">{trade.id}</span>} />
            <Row label="Exchange" value={trade.exchange} />
            {trade.order?.brokerOrderId && (
              <Row label="Broker Order ID" value={<span className="text-xs font-mono text-gray-400">{trade.order.brokerOrderId}</span>} />
            )}
            {trade.order?.strategy && (
              <Row label="Strategy" value={`${trade.order.strategy.name} (${trade.order.strategy.type})`} />
            )}
            {trade.order?.tag && (
              <Row label="Tag" value={trade.order.tag} />
            )}
          </div>

          {/* Execution */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Execution</p>
            <Row label="Quantity" value={trade.qty.toLocaleString('en-IN')} />
            <Row label="Entry Price" value={fmt(trade.entryPrice)} />
            <Row label="Exit Price" value={isClosed ? fmt(trade.exitPrice) : <span className="badge-yellow">OPEN</span>} />
            <Row label="Entry Time" value={fmtTime(trade.createdAt)} />
            <Row label="Exit Time" value={fmtTime(trade.closedAt)} />
            <Row label="Duration" value={holdingDuration(trade.createdAt, trade.closedAt)} />
          </div>

          {/* Risk */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Risk Parameters</p>
            <Row label="Stop Loss" value={trade.stopLoss != null ? fmt(trade.stopLoss) : 'N/A'} />
            <Row label="Target" value={trade.target != null ? fmt(trade.target) : 'N/A'} />
            {trade.stopLoss != null && trade.target != null && (
              <Row
                label="R:R Ratio"
                value={`1:${Math.abs((trade.target - trade.entryPrice) / (trade.entryPrice - trade.stopLoss)).toFixed(2)}`}
              />
            )}
          </div>

          {/* P&L breakdown */}
          {isClosed && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">P&L Breakdown</p>
              <Row label="Gross P&L" value={fmt(grossPnl)} valueClass={(grossPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'} />
              <Row label="Charges" value={fmt(-(trade.charges))} valueClass="text-red-400" />
              <Row label="Net P&L" value={fmt(netPnl)} valueClass={pnlColor} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
