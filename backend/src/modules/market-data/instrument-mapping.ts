import { instrumentRegistry, Instrument } from './instrument-registry';

/**
 * @deprecated Thin backward-compatible wrapper around `instrument-registry.ts`,
 * which is the actual single source of truth (loaded from NSE.json / MCX.json /
 * BSE.json via `instrument-loader.ts`). Kept so existing call sites
 * (market-data.service.ts, websocket.service.ts, etc.) don't need to change.
 */
export type InstrumentMapping = Instrument;

class InstrumentMappingService {
  getAll(): Instrument[] {
    return instrumentRegistry.getAll();
  }

  resolve(input: string): Instrument | undefined {
    return instrumentRegistry.resolve(input);
  }

  getInstrumentKey(input: string): string {
    return instrumentRegistry.getInstrumentKey(input);
  }

  getCanonicalSymbol(input: string): string {
    return instrumentRegistry.getCanonicalSymbol(input);
  }

  getTradingSymbol(input: string): string {
    return instrumentRegistry.getTradingSymbol(input);
  }
}

export const instrumentMappingService = new InstrumentMappingService();
