/**
 * Single source of truth for instrument identity on the frontend.
 *
 * The actual instrument master data (NSE.json / MCX.json / BSE.json) lives
 * on the backend (`instrument-registry.ts`) — this module is a thin client
 * that resolves identifiers via `/market/instruments/resolve` and caches the
 * results. No instrument keys, ISINs or trading symbols are hardcoded here.
 */
import { useEffect, useState } from 'react';
import { marketApi } from './api';

export interface InstrumentMapping {
  instrumentKey: string;
  canonicalSymbol: string;
  tradingSymbol: string;
  name: string;
  exchange: string;
  isin: string;
}

/** Backward-compatible alias used by older components. */
export type InstrumentInfo = InstrumentMapping & { key: string; label: string };

const cache = new Map<string, InstrumentMapping>();
const inFlight = new Map<string, Promise<void>>();

function cacheMapping(m: InstrumentMapping): void {
  cache.set(m.instrumentKey, m);
  cache.set(m.canonicalSymbol, m);
  cache.set(m.tradingSymbol.toUpperCase(), m);
}

/** Synchronous lookup against whatever has been resolved so far. */
export function getCached(input: string): InstrumentMapping | undefined {
  return cache.get(input.trim()) ?? cache.get(input.trim().toUpperCase());
}

/** Display label — resolved trading symbol if cached, else a best-effort fallback from the raw identifier. */
export function symbolLabel(input: string): string {
  const cached = getCached(input);
  if (cached) return cached.tradingSymbol;
  return input.split(/[|:]/).pop() ?? input;
}

export function isIndexSymbol(input: string): boolean {
  return /^(NSE_INDEX|BSE_INDEX)[|:]/.test(input);
}

/** Normalize any supported format to the app-wide instrument key. Falls back to the input if not yet resolved. */
export function getInstrumentKey(input: string): string {
  return getCached(input)?.instrumentKey ?? input;
}

/** Normalize any supported format to Upstox's "SEGMENT:TradingSymbol" quote-response key. Falls back to the input if not yet resolved. */
export function getCanonicalSymbol(input: string): string {
  return getCached(input)?.canonicalSymbol ?? input;
}

/**
 * Resolve and cache one or more identifiers (instrument key, canonical
 * symbol, ISIN, or bare trading symbol) against the backend instrument
 * registry. Already-cached identifiers are skipped.
 */
export async function resolveInstruments(symbols: string[]): Promise<InstrumentMapping[]> {
  const unresolved = [...new Set(symbols.map((s) => s.trim()).filter((s) => s && !getCached(s)))];

  await Promise.all(
    unresolved.map((s) => {
      let p = inFlight.get(s);
      if (!p) {
        p = marketApi
          .resolveInstruments(s)
          .then(({ data }) => {
            const result = (data as { data: Record<string, InstrumentMapping | null> }).data;
            const mapping = result[s];
            if (mapping) cacheMapping(mapping);
          })
          .catch(() => void 0)
          .finally(() => inFlight.delete(s));
        inFlight.set(s, p);
      }
      return p;
    }),
  );

  return symbols.map((s) => getCached(s)).filter((m): m is InstrumentMapping => Boolean(m));
}

/**
 * React hook: resolves the given identifiers against the backend registry
 * and triggers a re-render once cached, so `symbolLabel()` / `getInstrumentKey()`
 * etc. return up-to-date values.
 */
export function useInstrumentDirectory(symbols: string[]): void {
  const [, setVersion] = useState(0);
  const key = symbols.join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    resolveInstruments(key.split(',')).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
}

/**
 * Default watchlist seed (instrument keys). Labels, exchanges and ISINs for
 * these are resolved at runtime from the backend instrument registry via
 * `resolveInstruments` / `useInstrumentDirectory` — nothing else is hardcoded.
 */
export const DEFAULT_WATCHLIST: string[] = [
  'NSE_INDEX|Nifty 50',
  'NSE_INDEX|Nifty Bank',
  'BSE_INDEX|SENSEX',
  'NSE_EQ|INE002A01018', // Reliance
  'NSE_EQ|INE467B01029', // TCS
  'NSE_EQ|INE009A01021', // Infosys
  'NSE_EQ|INE040A01034', // HDFC Bank
  'NSE_EQ|INE090A01021', // ICICI Bank
  'MCX_FO|466583', // Gold
  'MCX_FO|464150', // Silver
];
