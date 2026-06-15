/**
 * Single source of truth for instrument identity on the frontend.
 *
 * - instrumentKey:    Upstox instrument key, e.g. "NSE_EQ|INE009A01021" — the
 *                      app-wide identifier used in watchlists, strategies and
 *                      websocket subscriptions. All `/market/*` API responses
 *                      are keyed by this format.
 * - canonicalSymbol:  Upstox market-quote response key, e.g. "NSE_EQ:INFY".
 * - tradingSymbol:    Bare exchange trading symbol, e.g. "INFY".
 *
 * Future NSE/Upstox instrument updates only require editing INSTRUMENT_MAP
 * below — everything else in the app resolves identifiers through the
 * helpers exported here.
 */
export interface InstrumentMapping {
  instrumentKey: string;
  canonicalSymbol: string;
  tradingSymbol: string;
  name: string;
  exchange: string;
  isin: string;
}

export const INSTRUMENT_MAP: InstrumentMapping[] = [
  { instrumentKey: 'NSE_INDEX|Nifty 50', canonicalSymbol: 'NSE_INDEX:Nifty 50', tradingSymbol: 'Nifty 50', name: 'NIFTY 50', exchange: 'NSE_INDEX', isin: '' },
  { instrumentKey: 'NSE_INDEX|Nifty Bank', canonicalSymbol: 'NSE_INDEX:Nifty Bank', tradingSymbol: 'Nifty Bank', name: 'NIFTY BANK', exchange: 'NSE_INDEX', isin: '' },
  { instrumentKey: 'BSE_INDEX|SENSEX', canonicalSymbol: 'BSE_INDEX:SENSEX', tradingSymbol: 'SENSEX', name: 'SENSEX', exchange: 'BSE_INDEX', isin: '' },

  { instrumentKey: 'NSE_EQ|INE002A01018', canonicalSymbol: 'NSE_EQ:RELIANCE', tradingSymbol: 'RELIANCE', name: 'RELIANCE INDUSTRIES LTD', exchange: 'NSE_EQ', isin: 'INE002A01018' },
  { instrumentKey: 'NSE_EQ|INE467B01029', canonicalSymbol: 'NSE_EQ:TCS', tradingSymbol: 'TCS', name: 'TATA CONSULTANCY SERV LT', exchange: 'NSE_EQ', isin: 'INE467B01029' },
  { instrumentKey: 'NSE_EQ|INE040A01034', canonicalSymbol: 'NSE_EQ:HDFCBANK', tradingSymbol: 'HDFCBANK', name: 'HDFC BANK LTD', exchange: 'NSE_EQ', isin: 'INE040A01034' },
  { instrumentKey: 'NSE_EQ|INE062A01020', canonicalSymbol: 'NSE_EQ:SBIN', tradingSymbol: 'SBIN', name: 'STATE BANK OF INDIA', exchange: 'NSE_EQ', isin: 'INE062A01020' },
  { instrumentKey: 'NSE_EQ|INE090A01021', canonicalSymbol: 'NSE_EQ:ICICIBANK', tradingSymbol: 'ICICIBANK', name: 'ICICI BANK LTD.', exchange: 'NSE_EQ', isin: 'INE090A01021' },
  { instrumentKey: 'NSE_EQ|INE009A01021', canonicalSymbol: 'NSE_EQ:INFY', tradingSymbol: 'INFY', name: 'INFOSYS LIMITED', exchange: 'NSE_EQ', isin: 'INE009A01021' },
  { instrumentKey: 'NSE_EQ|INE296A01032', canonicalSymbol: 'NSE_EQ:BAJFINANCE', tradingSymbol: 'BAJFINANCE', name: 'BAJAJ FINANCE LIMITED', exchange: 'NSE_EQ', isin: 'INE296A01032' },
  { instrumentKey: 'NSE_EQ|INE585B01010', canonicalSymbol: 'NSE_EQ:MARUTI', tradingSymbol: 'MARUTI', name: 'MARUTI SUZUKI INDIA LTD.', exchange: 'NSE_EQ', isin: 'INE585B01010' },
  { instrumentKey: 'NSE_EQ|INE154A01025', canonicalSymbol: 'NSE_EQ:ITC', tradingSymbol: 'ITC', name: 'ITC LTD', exchange: 'NSE_EQ', isin: 'INE154A01025' },
  { instrumentKey: 'NSE_EQ|INE075A01022', canonicalSymbol: 'NSE_EQ:WIPRO', tradingSymbol: 'WIPRO', name: 'WIPRO LTD', exchange: 'NSE_EQ', isin: 'INE075A01022' },

  { instrumentKey: 'MCX_FO|466583', canonicalSymbol: 'MCX_FO:GOLD', tradingSymbol: 'GOLD FUT 05 AUG 26', name: 'GOLD', exchange: 'MCX_FO', isin: '' },
  { instrumentKey: 'MCX_FO|464150', canonicalSymbol: 'MCX_FO:SILVER', tradingSymbol: 'SILVER FUT 03 JUL 26', name: 'SILVER', exchange: 'MCX_FO', isin: '' },
  { instrumentKey: 'MCX_FO|499095', canonicalSymbol: 'MCX_FO:CRUDEOIL', tradingSymbol: 'CRUDEOIL FUT 18 JUN 26', name: 'CRUDE OIL', exchange: 'MCX_FO', isin: '' },
  { instrumentKey: 'MCX_FO|504265', canonicalSymbol: 'MCX_FO:NATURALGAS', tradingSymbol: 'NATURALGAS FUT 25 JUN 26', name: 'NATURALGAS', exchange: 'MCX_FO', isin: '' },
  { instrumentKey: 'MCX_FO|552708', canonicalSymbol: 'MCX_FO:COPPER', tradingSymbol: 'COPPER FUT 30 JUN 26', name: 'COPPER', exchange: 'MCX_FO', isin: '' },
];

const byInstrumentKey = new Map(INSTRUMENT_MAP.map((i) => [i.instrumentKey, i]));
const byCanonicalSymbol = new Map(INSTRUMENT_MAP.map((i) => [i.canonicalSymbol, i]));
const byTradingSymbol = new Map<string, InstrumentMapping>();
for (const i of INSTRUMENT_MAP) {
  if (!byTradingSymbol.has(i.tradingSymbol.toUpperCase())) {
    byTradingSymbol.set(i.tradingSymbol.toUpperCase(), i);
  }
}

/**
 * Resolve any supported identifier format to its mapping entry:
 *  - instrument key   "NSE_EQ|INE009A01021"
 *  - canonical symbol "NSE_EQ:INFY"
 *  - bare symbol      "INFY"
 */
export function resolveInstrument(input: string): InstrumentMapping | undefined {
  const trimmed = input.trim();
  return byInstrumentKey.get(trimmed) ?? byCanonicalSymbol.get(trimmed) ?? byTradingSymbol.get(trimmed.toUpperCase());
}

/** Normalize any supported format to the app-wide instrument key. Unmapped input passes through unchanged. */
export function getInstrumentKey(input: string): string {
  return resolveInstrument(input)?.instrumentKey ?? input;
}

/** Normalize any supported format to Upstox's "SEGMENT:TradingSymbol" quote-response key. Unmapped input passes through unchanged. */
export function getCanonicalSymbol(input: string): string {
  return resolveInstrument(input)?.canonicalSymbol ?? input;
}

/** Display label for a symbol — bare trading symbol if known, else the raw identifier's suffix. */
export function symbolLabel(input: string): string {
  const mapping = resolveInstrument(input);
  if (mapping) return mapping.tradingSymbol;
  return input.split(/[|:]/).pop() ?? input;
}

export function isIndexSymbol(input: string): boolean {
  const key = getInstrumentKey(input);
  return key.startsWith('NSE_INDEX|') || key.startsWith('BSE_INDEX|');
}

// ─── Derived UI helpers (backward-compatible with the old symbols.ts API) ────
export interface InstrumentInfo {
  key: string;
  label: string;
  exchange: string;
  name?: string;
}

export const INSTRUMENT_DIRECTORY: InstrumentInfo[] = INSTRUMENT_MAP.map((i) => ({
  key: i.instrumentKey,
  label: i.tradingSymbol,
  exchange: i.exchange,
  name: i.name,
}));

export const SYMBOL_LABELS: Record<string, string> = Object.fromEntries(
  INSTRUMENT_MAP.map((i) => [i.instrumentKey, i.tradingSymbol]),
);

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
