import { instrumentLoader, RawInstrument } from './instrument-loader';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'InstrumentRegistry' });

/**
 * Normalized instrument shape used throughout the platform.
 *
 * - instrumentKey:    Upstox instrument key, e.g. "NSE_EQ|INE002A01018" — the
 *                      app-wide primary identifier (orders, candles, websocket).
 * - canonicalSymbol:  Upstox market-quote response key, "SEGMENT:TradingSymbol",
 *                      e.g. "NSE_EQ:RELIANCE".
 * - tradingSymbol:    Exchange trading symbol, e.g. "RELIANCE" or
 *                      "NIFTY 27000 CE 30 JUN 26" for derivatives.
 */
export interface Instrument {
  instrumentKey: string;
  canonicalSymbol: string;
  tradingSymbol: string;
  name: string;
  exchange: string; // segment, e.g. NSE_EQ, NSE_FO, MCX_FO, BSE_EQ, NSE_INDEX
  isin: string;
  instrumentType: string;
  expiry: number | null;
  strikePrice: number | null;
  lotSize: number;
  underlyingSymbol: string;
  tickSize: number;
}

export type OptionType = 'CE' | 'PE';

export interface OptionChainEntry {
  strike: number;
  ce?: Instrument;
  pe?: Instrument;
}

export interface OptionChain {
  underlying: string;
  expiry: number;
  strikes: OptionChainEntry[];
}

const DERIVATIVE_TYPES = new Set(['CE', 'PE', 'FUT']);

function toInstrument(r: RawInstrument): Instrument {
  return {
    instrumentKey: r.instrument_key,
    canonicalSymbol: `${r.segment}:${r.trading_symbol}`,
    tradingSymbol: r.trading_symbol,
    name: r.name ?? r.trading_symbol,
    exchange: r.segment,
    isin: r.isin ?? '',
    instrumentType: r.instrument_type ?? '',
    expiry: r.expiry ?? null,
    strikePrice: r.strike_price ?? null,
    lotSize: r.lot_size ?? 1,
    underlyingSymbol: (r.underlying_symbol ?? r.asset_symbol ?? '').toUpperCase(),
    tickSize: r.tick_size ?? 0.05,
  };
}

class InstrumentRegistry {
  private instruments: Instrument[] | null = null;
  private byInstrumentKey = new Map<string, Instrument>();
  private byCanonicalSymbol = new Map<string, Instrument>();
  private byIsin = new Map<string, Instrument>();
  private byTradingSymbol = new Map<string, Instrument>();
  /** Derivative contracts (CE/PE/FUT) grouped by underlying symbol (uppercased). */
  private byUnderlying = new Map<string, Instrument[]>();

  private build(): void {
    if (this.instruments) return;

    const raw = instrumentLoader.getAll();
    const instruments = raw.map(toInstrument);

    // Pass 1: cash/index instruments take priority for bare-symbol lookups.
    for (const i of instruments) {
      this.byInstrumentKey.set(i.instrumentKey, i);
      this.byCanonicalSymbol.set(i.canonicalSymbol, i);
      // Same ISIN can be cross-listed on NSE and BSE — first-loaded (NSE) wins.
      if (i.isin && !this.byIsin.has(i.isin)) this.byIsin.set(i.isin, i);

      if (!DERIVATIVE_TYPES.has(i.instrumentType)) {
        const key = i.tradingSymbol.toUpperCase();
        if (!this.byTradingSymbol.has(key)) this.byTradingSymbol.set(key, i);
      }
    }

    // Pass 2: derivatives — index by underlying symbol, fall back for bare-symbol lookups.
    for (const i of instruments) {
      if (!DERIVATIVE_TYPES.has(i.instrumentType)) continue;

      const underlying = i.underlyingSymbol;
      if (underlying) {
        const list = this.byUnderlying.get(underlying);
        if (list) list.push(i);
        else this.byUnderlying.set(underlying, [i]);
      }

      const key = i.tradingSymbol.toUpperCase();
      if (!this.byTradingSymbol.has(key)) this.byTradingSymbol.set(key, i);
    }

    this.instruments = instruments;
    log.info('Instrument registry built', {
      total: instruments.length,
      byInstrumentKey: this.byInstrumentKey.size,
      byUnderlying: this.byUnderlying.size,
    });
  }

  /** All instruments (NSE + MCX + BSE masters). */
  getAll(): Instrument[] {
    this.build();
    return this.instruments!;
  }

  /**
   * Resolve any supported identifier format to its instrument:
   *  - instrument key   "NSE_EQ|INE002A01018"
   *  - canonical symbol "NSE_EQ:RELIANCE"
   *  - ISIN             "INE002A01018"
   *  - bare symbol      "RELIANCE"
   */
  resolve(input: string): Instrument | undefined {
    this.build();
    const trimmed = input.trim();
    return (
      this.byInstrumentKey.get(trimmed) ??
      this.byCanonicalSymbol.get(trimmed) ??
      this.byIsin.get(trimmed) ??
      this.byTradingSymbol.get(trimmed.toUpperCase())
    );
  }

  /** Normalize any supported format to the app-wide instrument key. Unmapped input passes through unchanged. */
  getInstrumentKey(input: string): string {
    return this.resolve(input)?.instrumentKey ?? input;
  }

  /** Normalize any supported format to Upstox's "SEGMENT:TradingSymbol" quote-response key. Unmapped input passes through unchanged. */
  getCanonicalSymbol(input: string): string {
    return this.resolve(input)?.canonicalSymbol ?? input;
  }

  /** Normalize any supported format to its bare trading symbol. Unmapped input passes through unchanged. */
  getTradingSymbol(input: string): string {
    return this.resolve(input)?.tradingSymbol ?? input;
  }

  /** Full-text search across instrument key, trading symbol, name and ISIN. */
  search(query: string, limit = 20, exchanges?: string[]): Instrument[] {
    this.build();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: Instrument[] = [];
    for (const i of this.instruments!) {
      if (exchanges && !exchanges.includes(i.exchange)) continue;
      if (
        i.tradingSymbol.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.instrumentKey.toLowerCase().includes(q) ||
        i.isin.toLowerCase() === q
      ) {
        results.push(i);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // ─── Derivatives helpers ─────────────────────────────────────────────────

  private derivativeContracts(underlying: string): Instrument[] {
    this.build();
    return this.byUnderlying.get(underlying.toUpperCase()) ?? [];
  }

  /** All CE + PE contracts for an underlying (e.g. "NIFTY", "BANKNIFTY", "RELIANCE"), optionally filtered to one expiry. */
  getOptionContracts(underlying: string, expiry?: number): Instrument[] {
    return this.derivativeContracts(underlying).filter(
      (i) => (i.instrumentType === 'CE' || i.instrumentType === 'PE') && (expiry === undefined || i.expiry === expiry),
    );
  }

  getCEContracts(underlying: string, expiry?: number): Instrument[] {
    return this.derivativeContracts(underlying).filter(
      (i) => i.instrumentType === 'CE' && (expiry === undefined || i.expiry === expiry),
    );
  }

  getPEContracts(underlying: string, expiry?: number): Instrument[] {
    return this.derivativeContracts(underlying).filter(
      (i) => i.instrumentType === 'PE' && (expiry === undefined || i.expiry === expiry),
    );
  }

  /** Earliest expiry (epoch ms) >= now for the given underlying and contract type. */
  getNearestExpiry(underlying: string, type: OptionType | 'FUT' = 'CE', now = Date.now()): number | null {
    const contracts = this.derivativeContracts(underlying).filter((i) => i.instrumentType === type && i.expiry !== null && i.expiry >= now);
    if (contracts.length === 0) return null;
    return Math.min(...contracts.map((i) => i.expiry as number));
  }

  /** Strike price closest to spotPrice among CE contracts for the given (or nearest) expiry. */
  getATMStrike(underlying: string, spotPrice: number, expiry?: number): number | null {
    const targetExpiry = expiry ?? this.getNearestExpiry(underlying, 'CE');
    if (targetExpiry === null) return null;
    const contracts = this.getCEContracts(underlying, targetExpiry).filter((i) => i.strikePrice !== null);
    if (contracts.length === 0) return null;
    let closest = contracts[0];
    for (const c of contracts) {
      if (Math.abs((c.strikePrice as number) - spotPrice) < Math.abs((closest.strikePrice as number) - spotPrice)) {
        closest = c;
      }
    }
    return closest.strikePrice;
  }

  /** Full option chain (CE/PE paired by strike) for an underlying at the given (or nearest) expiry. */
  getOptionChain(underlying: string, expiry?: number): OptionChain | null {
    const targetExpiry = expiry ?? this.getNearestExpiry(underlying, 'CE');
    if (targetExpiry === null) return null;

    const strikes = new Map<number, OptionChainEntry>();
    for (const c of this.getCEContracts(underlying, targetExpiry)) {
      if (c.strikePrice === null) continue;
      const entry = strikes.get(c.strikePrice) ?? { strike: c.strikePrice };
      entry.ce = c;
      strikes.set(c.strikePrice, entry);
    }
    for (const c of this.getPEContracts(underlying, targetExpiry)) {
      if (c.strikePrice === null) continue;
      const entry = strikes.get(c.strikePrice) ?? { strike: c.strikePrice };
      entry.pe = c;
      strikes.set(c.strikePrice, entry);
    }

    return {
      underlying: underlying.toUpperCase(),
      expiry: targetExpiry,
      strikes: [...strikes.values()].sort((a, b) => a.strike - b.strike),
    };
  }

  /** All futures contracts for an underlying, sorted by expiry ascending. */
  getFutureContracts(underlying: string): Instrument[] {
    return this.derivativeContracts(underlying)
      .filter((i) => i.instrumentType === 'FUT' && i.expiry !== null)
      .sort((a, b) => (a.expiry as number) - (b.expiry as number));
  }

  /** Nearest non-expired futures contract (the "current" / front month). */
  getCurrentFuture(underlying: string, now = Date.now()): Instrument | null {
    const contracts = this.getFutureContracts(underlying).filter((i) => (i.expiry as number) >= now);
    return contracts[0] ?? null;
  }

  /** Second-nearest non-expired futures contract (the "next" / mid month). */
  getNextFuture(underlying: string, now = Date.now()): Instrument | null {
    const contracts = this.getFutureContracts(underlying).filter((i) => (i.expiry as number) >= now);
    return contracts[1] ?? null;
  }
}

export const instrumentRegistry = new InstrumentRegistry();
