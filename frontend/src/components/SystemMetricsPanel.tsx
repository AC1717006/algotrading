'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { systemApi } from '@/lib/api';

interface SystemMetrics {
  latency: {
    avgLatencyMs: number;
    sampleCount: number;
    requestsLastMinute: number;
    rateLimitPerMinute: number;
    rateLimitUsagePct: number;
  };
  riskExposure: {
    activeStrategies: number;
    totalRiskBudget: number;
    equity: number;
    openPositionsValue: number;
    exposurePct: number;
    circuitBreakerActive: boolean;
  };
}

function usageGlow(pct: number): string {
  if (pct >= 90) return 'glow-red';
  if (pct >= 70) return 'glow-yellow';
  return 'glow-green';
}

function usageBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

export function SystemMetricsPanel() {
  const { data } = useQuery({
    queryKey: ['system-metrics'],
    queryFn: () => systemApi.metrics().then((r) => (r.data as { data: SystemMetrics }).data),
    refetchInterval: 10_000,
  });

  const latency = data?.latency;
  const risk = data?.riskExposure;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white mb-3">System Metrics</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Latency */}
        <div className="space-y-1.5">
          <p className="stat-label">Upstox API Latency</p>
          <p className="stat-value">{latency ? `${latency.avgLatencyMs}ms` : '—'}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Avg over last {latency?.sampleCount ?? 0} calls
          </p>
        </div>

        {/* Rate limit usage */}
        <div className="space-y-1.5">
          <p className="stat-label">API Limit Usage</p>
          <p className="stat-value">{latency ? `${latency.rateLimitUsagePct}%` : '—'}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {latency?.requestsLastMinute ?? 0} / {latency?.rateLimitPerMinute ?? '—'} req/min
          </p>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', usageBarColor(latency?.rateLimitUsagePct ?? 0))}
              style={{ width: `${Math.min(latency?.rateLimitUsagePct ?? 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Risk exposure */}
        <div className={clsx('space-y-1.5 rounded-lg p-3 -m-3', risk && usageGlow(risk.exposurePct))}>
          <p className="stat-label">Active Strategy Risk Exposure</p>
          <p className="stat-value">{risk ? `${risk.exposurePct}%` : '—'}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            ₹{(risk?.totalRiskBudget ?? 0).toLocaleString('en-IN')} budget across {risk?.activeStrategies ?? 0} active
            {' '}· open positions ₹{(risk?.openPositionsValue ?? 0).toLocaleString('en-IN')}
          </p>
          {risk?.circuitBreakerActive && (
            <span className="badge-red mt-1">Circuit Breaker Active</span>
          )}
        </div>
      </div>
    </div>
  );
}
