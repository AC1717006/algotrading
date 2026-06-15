import { logger } from '../../utils/logger';
import { instrumentMappingService, InstrumentMapping } from './instrument-mapping';

const log = logger.child({ category: 'Instruments' });

export interface InstrumentInfo {
  key: string;
  label: string;
  name: string;
  exchange: string;
  isin: string;
  canonicalSymbol: string;
}

class InstrumentService {
  private nseInstruments: InstrumentMapping[] | null = null;

  private getNseInstruments(): InstrumentMapping[] {
    if (!this.nseInstruments) {
      this.nseInstruments = instrumentMappingService.getAll().filter((i) => i.exchange === 'NSE_EQ');
      log.info(`Loaded ${this.nseInstruments.length} NSE MIS instruments`);
    }
    return this.nseInstruments;
  }

  searchNse(query: string, limit = 20): InstrumentInfo[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.getNseInstruments()
      .filter(
        (i) =>
          i.tradingSymbol.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          i.instrumentKey.toLowerCase().includes(q),
      )
      .slice(0, limit)
      .map((i) => ({
        key: i.instrumentKey,
        label: i.tradingSymbol,
        name: i.name,
        exchange: i.exchange,
        isin: i.isin,
        canonicalSymbol: i.canonicalSymbol,
      }));
  }
}

export const instrumentService = new InstrumentService();
