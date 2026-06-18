'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/lib/api';
import { isMarketOpen } from '@/lib/market';

/** Canonical poll durations. */
export const POLL = {
  MARKET_CLOSED: 30_000,
  MARKET_OPEN: 2_000,
  POSITIONS_OPEN: 1_000,
} as const;

/**
 * Returns the appropriate quote-poll interval in ms:
 *  - 30 000  market closed (Mon-Fri outside 09:15–15:30 IST, or weekend)
 *  -  2 000  market open, no open positions
 *  -  1 000  market open AND open positions exist
 *
 * Internally shares the ['trading-summary'] React Query key with the
 * dashboard page, so no extra network requests are made — the summary
 * result is served from the shared query cache.
 */
export function usePollInterval(): number {
  const [marketOpen, setMarketOpen] = useState(isMarketOpen);

  // Re-evaluate at market open/close transitions (~1 min accuracy is fine).
  useEffect(() => {
    const t = setInterval(() => setMarketOpen(isMarketOpen()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data: summary } = useQuery({
    queryKey: ['trading-summary'],
    queryFn: () =>
      tradingApi.getSummary().then((r) => (r.data as { data: Record<string, unknown> }).data),
    refetchInterval: marketOpen ? 10_000 : false,
    enabled: marketOpen,
  });

  const hasOpenPositions = ((summary?.openPositions as number) ?? 0) > 0;

  if (!marketOpen) return POLL.MARKET_CLOSED;
  if (hasOpenPositions) return POLL.POSITIONS_OPEN;
  return POLL.MARKET_OPEN;
}
