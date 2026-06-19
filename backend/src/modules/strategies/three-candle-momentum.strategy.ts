import { Candle, StrategySignal } from '../../types';
import { BaseStrategy, StrategyConfig } from './base.strategy';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'ThreeCandleMomentum' });

// Trading window in IST: 9:20 – 15:15
const WINDOW_START_MINUTES = 9 * 60 + 20;   // 560
const WINDOW_END_MINUTES   = 15 * 60 + 15;  // 915

function getISTMinutes(): number {
  const now = new Date();
  // UTC + 5h30m
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return ist.getHours() * 60 + ist.getMinutes();
}

export class ThreeCandleMomentumStrategy extends BaseStrategy {
  constructor(cfg: StrategyConfig) {
    super(cfg);
  }

  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const now = getISTMinutes();

    if (now < WINDOW_START_MINUTES) {
      return this.hold(`Before trading window (IST ${Math.floor(now / 60)}:${String(now % 60).padStart(2, '0')} < 09:20)`);
    }
    if (now > WINDOW_END_MINUTES) {
      return this.hold(`After trading window (IST ${Math.floor(now / 60)}:${String(now % 60).padStart(2, '0')} > 15:15)`);
    }

    // Need at least 4 candles: 3 signal candles + 1 current (partially formed)
    if (candles.length < 4) {
      return this.hold(`Not enough candles: ${candles.length} < 4`);
    }

    const n = candles.length;
    const c1 = candles[n - 4]!; // oldest of the 3 signal candles
    const c2 = candles[n - 3]!;
    const c3 = candles[n - 2]!; // most recent completed signal candle
    // c4 (n-1) is the current (possibly incomplete) candle — we enter at its open ~ currentPrice

    log.debug('Candle analysis', {
      c1: { o: c1.open, c: c1.close },
      c2: { o: c2.open, c: c2.close },
      c3: { o: c3.open, c: c3.close },
      currentPrice,
    });

    const c1Green = c1.close > c1.open;
    const c2Green = c2.close > c2.open;
    const c3Green = c3.close > c3.open;

    const c1Red = c1.close < c1.open;
    const c2Red = c2.close < c2.open;
    const c3Red = c3.close < c3.open;

    if (c1Green && c2Green && c3Green) {
      const entryPrice = currentPrice;       // ≈ Candle4 open
      const stopLoss   = c1.open;            // Candle1 open as specified
      const target     = entryPrice * 1.02;  // +2%

      if (entryPrice <= stopLoss) {
        return this.hold('BUY setup invalid: entry <= SL (price below candle1 open)');
      }

      const reason =
        `3 consecutive GREEN candles — ` +
        `C1[${c1.open.toFixed(1)}→${c1.close.toFixed(1)}] ` +
        `C2[${c2.open.toFixed(1)}→${c2.close.toFixed(1)}] ` +
        `C3[${c3.open.toFixed(1)}→${c3.close.toFixed(1)}]`;

      log.info('BUY signal generated', { symbol: this.cfg.symbol, entryPrice, stopLoss, target, reason });

      return {
        type: 'BUY',
        symbol: this.cfg.symbol,
        exchange: this.cfg.exchange,
        price: entryPrice,
        stopLoss,
        target,
        strength: 1.0,
        reason,
        indicators: {
          c1_open: c1.open, c1_close: c1.close,
          c2_open: c2.open, c2_close: c2.close,
          c3_open: c3.open, c3_close: c3.close,
        },
      };
    }

    if (c1Red && c2Red && c3Red) {
      const entryPrice = currentPrice;       // ≈ Candle4 open
      const stopLoss   = c1.open;            // Candle1 open (above entry for short)
      const target     = entryPrice * 0.98;  // -2%

      if (entryPrice >= stopLoss) {
        return this.hold('SELL setup invalid: entry >= SL (price above candle1 open)');
      }

      const reason =
        `3 consecutive RED candles — ` +
        `C1[${c1.open.toFixed(1)}→${c1.close.toFixed(1)}] ` +
        `C2[${c2.open.toFixed(1)}→${c2.close.toFixed(1)}] ` +
        `C3[${c3.open.toFixed(1)}→${c3.close.toFixed(1)}]`;

      log.info('SELL signal generated', { symbol: this.cfg.symbol, entryPrice, stopLoss, target, reason });

      return {
        type: 'SELL',
        symbol: this.cfg.symbol,
        exchange: this.cfg.exchange,
        price: entryPrice,
        stopLoss,
        target,
        strength: 1.0,
        reason,
        indicators: {
          c1_open: c1.open, c1_close: c1.close,
          c2_open: c2.open, c2_close: c2.close,
          c3_open: c3.open, c3_close: c3.close,
        },
      };
    }

    const summary =
      `${c1Green ? 'G' : c1Red ? 'R' : 'D'}` +
      `${c2Green ? 'G' : c2Red ? 'R' : 'D'}` +
      `${c3Green ? 'G' : c3Red ? 'R' : 'D'}`;

    return this.hold(`No 3-candle setup — pattern: ${summary}`);
  }
}
