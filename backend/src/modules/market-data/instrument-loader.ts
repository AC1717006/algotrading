import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'InstrumentLoader' });

/**
 * Raw record shape as published in the Upstox instrument master files
 * (NSE.json, MCX.json, BSE.json). Only a subset of fields is required;
 * everything else is optional and varies by segment/instrument type.
 */
export interface RawInstrument {
  segment: string;
  name?: string;
  exchange?: string;
  isin?: string;
  instrument_key: string;
  trading_symbol: string;
  instrument_type?: string;
  expiry?: number;
  strike_price?: number;
  lot_size?: number;
  underlying_symbol?: string;
  underlying_key?: string;
  asset_symbol?: string;
  tick_size?: number;
  freeze_quantity?: number;
  short_name?: string;
}

export interface MasterFileStats {
  file: string;
  found: boolean;
  total: number;
  valid: number;
  invalid: number;
}

// Instrument master files, expected at the project root.
const MASTER_FILES = ['NSE.json', 'MCX.json', 'BSE.json'] as const;

function resolveMasterDir(): string {
  // backend runs with cwd == backend/, masters live one level up at the project root.
  return process.env.INSTRUMENT_MASTER_DIR ?? path.join(process.cwd(), '..');
}

function isValidRecord(r: unknown): r is RawInstrument {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.instrument_key === 'string' && o.instrument_key.length > 0 &&
    typeof o.segment === 'string' && o.segment.length > 0 &&
    typeof o.trading_symbol === 'string' && o.trading_symbol.length > 0
  );
}

class InstrumentLoader {
  private instruments: RawInstrument[] | null = null;
  private stats: MasterFileStats[] = [];

  /** Loads and validates NSE.json / MCX.json / BSE.json from the project root (cached). */
  load(): RawInstrument[] {
    if (this.instruments) return this.instruments;

    const dir = resolveMasterDir();
    const all: RawInstrument[] = [];
    const stats: MasterFileStats[] = [];

    for (const file of MASTER_FILES) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) {
        log.error(`Instrument master not found: ${filePath}`);
        stats.push({ file, found: false, total: 0, valid: 0, invalid: 0 });
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
        if (!Array.isArray(raw)) throw new Error('expected a JSON array');

        let valid = 0;
        let invalid = 0;
        for (const record of raw) {
          if (isValidRecord(record)) {
            all.push(record);
            valid++;
          } else {
            invalid++;
          }
        }

        stats.push({ file, found: true, total: raw.length, valid, invalid });
        log.info(`Loaded instrument master ${file}`, { total: raw.length, valid, invalid });
      } catch (err) {
        stats.push({ file, found: true, total: 0, valid: 0, invalid: 0 });
        log.error(`Failed to parse instrument master ${file}`, {
          filePath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.instruments = all;
    this.stats = stats;
    log.info('Instrument master load complete', { totalInstruments: all.length });
    return all;
  }

  getAll(): RawInstrument[] {
    return this.load();
  }

  getStats(): MasterFileStats[] {
    this.load();
    return this.stats;
  }
}

export const instrumentLoader = new InstrumentLoader();
