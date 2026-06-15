import { logger } from '../../utils/logger';
import { instrumentRegistry, Instrument, OptionChain } from './instrument-registry';

const log = logger.child({ category: 'Instruments' });

export interface InstrumentInfo {
  key: string;
  label: string;
  name: string;
  exchange: string;
  isin: string;
  canonicalSymbol: string;
}

function toInfo(i: Instrument): InstrumentInfo {
  return {
    key: i.instrumentKey,
    label: i.tradingSymbol,
    name: i.name,
    exchange: i.exchange,
    isin: i.isin,
    canonicalSymbol: i.canonicalSymbol,
  };
}

class InstrumentService {
  /** Search NSE equities by symbol, name or instrument key. */
  searchNse(query: string, limit = 20): InstrumentInfo[] {
    return instrumentRegistry.search(query, limit, ['NSE_EQ']).map(toInfo);
  }

  /** Search across all loaded exchanges (NSE/BSE/MCX, equities + indices + derivatives). */
  search(query: string, limit = 20, exchanges?: string[]): InstrumentInfo[] {
    return instrumentRegistry.search(query, limit, exchanges).map(toInfo);
  }

  /** Resolve any supported identifier (instrument key, canonical symbol, ISIN, or bare symbol) to its instrument. */
  resolve(symbol: string): InstrumentInfo | null {
    const instrument = instrumentRegistry.resolve(symbol);
    return instrument ? toInfo(instrument) : null;
  }

  getOptionChain(underlying: string, expiry?: number): OptionChain | null {
    return instrumentRegistry.getOptionChain(underlying, expiry);
  }

  getFutureContracts(underlying: string): InstrumentInfo[] {
    return instrumentRegistry.getFutureContracts(underlying).map(toInfo);
  }

  getCurrentFuture(underlying: string): InstrumentInfo | null {
    const f = instrumentRegistry.getCurrentFuture(underlying);
    return f ? toInfo(f) : null;
  }

  getNextFuture(underlying: string): InstrumentInfo | null {
    const f = instrumentRegistry.getNextFuture(underlying);
    return f ? toInfo(f) : null;
  }
}

export const instrumentService = new InstrumentService();
log.info('Instrument service ready', { totalInstruments: instrumentRegistry.getAll().length });
