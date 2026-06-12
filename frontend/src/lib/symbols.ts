export interface InstrumentInfo {
  key: string;
  label: string;
  exchange: string;
}

export const INSTRUMENT_DIRECTORY: InstrumentInfo[] = [
  { key: 'NSE_INDEX|Nifty 50', label: 'NIFTY 50', exchange: 'NSE_INDEX' },
  { key: 'NSE_INDEX|Nifty Bank', label: 'BANK NIFTY', exchange: 'NSE_INDEX' },
  { key: 'BSE_INDEX|SENSEX', label: 'SENSEX', exchange: 'BSE_INDEX' },
  { key: 'NSE_EQ|INE009A01021', label: 'RELIANCE', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE467B01029', label: 'TCS', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE040A01034', label: 'HDFCBANK', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE062A01020', label: 'SBIN', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE090A01021', label: 'ICICIBANK', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE148A01014', label: 'INFY', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE669C01036', label: 'BAJFINANCE', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE585B01010', label: 'MARUTI', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE029A01011', label: 'ITC', exchange: 'NSE_EQ' },
  { key: 'NSE_EQ|INE117A01022', label: 'WIPRO', exchange: 'NSE_EQ' },
  { key: 'MCX_FO|466583', label: 'GOLD', exchange: 'MCX_FO' },
  { key: 'MCX_FO|464150', label: 'SILVER', exchange: 'MCX_FO' },
  { key: 'MCX_FO|499095', label: 'CRUDE OIL', exchange: 'MCX_FO' },
  { key: 'MCX_FO|504265', label: 'NATURAL GAS', exchange: 'MCX_FO' },
  { key: 'MCX_FO|552708', label: 'COPPER', exchange: 'MCX_FO' },
];

export const SYMBOL_LABELS: Record<string, string> = Object.fromEntries(
  INSTRUMENT_DIRECTORY.map((i) => [i.key, i.label]),
);

export const DEFAULT_WATCHLIST: string[] = [
  'NSE_INDEX|Nifty 50',
  'NSE_INDEX|Nifty Bank',
  'BSE_INDEX|SENSEX',
  'NSE_EQ|INE009A01021', // Reliance
  'NSE_EQ|INE467B01029', // TCS
  'NSE_EQ|INE148A01014', // Infosys
  'NSE_EQ|INE040A01034', // HDFC Bank
  'NSE_EQ|INE090A01021', // ICICI Bank
  'MCX_FO|466583', // Gold
  'MCX_FO|464150', // Silver
];

export function symbolLabel(key: string): string {
  return SYMBOL_LABELS[key] ?? key.split('|').pop() ?? key;
}

export function isIndexSymbol(key: string): boolean {
  return key.startsWith('NSE_INDEX|') || key.startsWith('BSE_INDEX|');
}
