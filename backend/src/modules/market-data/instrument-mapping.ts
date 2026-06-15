import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'InstrumentMapping' });

/**
 * Single source of truth for instrument identity across the platform.
 *
 * - instrumentKey:    Upstox instrument key, e.g. "NSE_EQ|INE009A01021" — used for
 *                      historical/candle APIs, order placement, and as the app-wide
 *                      identifier for watchlists, strategies and websocket subscriptions.
 * - canonicalSymbol:  Upstox market-quote response key, e.g. "NSE_EQ:INFY" — the
 *                      `/market-quote/quotes` and `/market-quote/ltp` endpoints key
 *                      their response objects by this format, NOT by instrumentKey.
 * - tradingSymbol:    Bare exchange trading symbol, e.g. "INFY".
 */
export interface InstrumentMapping {
  instrumentKey: string;
  canonicalSymbol: string;
  tradingSymbol: string;
  name: string;
  exchange: string;
  isin: string;
}

interface RawMisInstrument {
  segment: string;
  name: string;
  exchange: string;
  isin?: string;
  instrument_key: string;
  trading_symbol: string;
}

// Indices are not part of the MIS instrument master files but are required
// by the dashboard ticker/watchlist. Upstox quote responses key these with
// the same "SEGMENT:TradingSymbol" canonical format as equities.
const STATIC_INSTRUMENTS: InstrumentMapping[] = [
  { instrumentKey: 'NSE_INDEX|Nifty 50', canonicalSymbol: 'NSE_INDEX:Nifty 50', tradingSymbol: 'Nifty 50', name: 'NIFTY 50', exchange: 'NSE_INDEX', isin: '' },
  { instrumentKey: 'NSE_INDEX|Nifty Bank', canonicalSymbol: 'NSE_INDEX:Nifty Bank', tradingSymbol: 'Nifty Bank', name: 'NIFTY BANK', exchange: 'NSE_INDEX', isin: '' },
  { instrumentKey: 'BSE_INDEX|SENSEX', canonicalSymbol: 'BSE_INDEX:SENSEX', tradingSymbol: 'SENSEX', name: 'SENSEX', exchange: 'BSE_INDEX', isin: '' },
];

// MIS instrument master files to load (relative to backend/data).
const MIS_FILES = ['NSE_MIS.json', 'MCX_MIS.json'];

class InstrumentMappingService {
  private mappings: InstrumentMapping[] | null = null;
  private byInstrumentKey = new Map<string, InstrumentMapping>();
  private byCanonicalSymbol = new Map<string, InstrumentMapping>();
  private byTradingSymbol = new Map<string, InstrumentMapping>();

  private loadJson<T>(filename: string): T {
    const filePath = path.join(process.cwd(), 'data', filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  }

  private build(): void {
    if (this.mappings) return;

    const mappings: InstrumentMapping[] = [...STATIC_INSTRUMENTS];

    for (const file of MIS_FILES) {
      try {
        const raw = this.loadJson<RawMisInstrument[]>(file);
        for (const i of raw) {
          mappings.push({
            instrumentKey: i.instrument_key,
            canonicalSymbol: `${i.segment}:${i.trading_symbol}`,
            tradingSymbol: i.trading_symbol,
            name: i.name,
            exchange: i.segment,
            isin: i.isin ?? '',
          });
        }
      } catch (err) {
        log.warn(`Could not load instrument master ${file}`, { err });
      }
    }

    for (const m of mappings) {
      this.byInstrumentKey.set(m.instrumentKey, m);
      this.byCanonicalSymbol.set(m.canonicalSymbol, m);
      // First entry wins for ambiguous bare trading symbols (e.g. futures
      // contracts share a trading symbol prefix across expiries).
      if (!this.byTradingSymbol.has(m.tradingSymbol.toUpperCase())) {
        this.byTradingSymbol.set(m.tradingSymbol.toUpperCase(), m);
      }
    }

    this.mappings = mappings;
    log.info('Instrument mapping loaded', { total: mappings.length });
  }

  /** All known instrument mappings (static indices + NSE/MCX MIS masters). */
  getAll(): InstrumentMapping[] {
    this.build();
    return this.mappings!;
  }

  /**
   * Resolve any supported identifier format to its mapping entry:
   *  - instrument key   "NSE_EQ|INE009A01021"
   *  - canonical symbol "NSE_EQ:INFY"
   *  - bare symbol      "INFY"
   */
  resolve(input: string): InstrumentMapping | undefined {
    this.build();
    const trimmed = input.trim();
    if (this.byInstrumentKey.has(trimmed)) return this.byInstrumentKey.get(trimmed);
    if (this.byCanonicalSymbol.has(trimmed)) return this.byCanonicalSymbol.get(trimmed);
    return this.byTradingSymbol.get(trimmed.toUpperCase());
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
}

export const instrumentMappingService = new InstrumentMappingService();
