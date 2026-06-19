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
    const istHH = Math.floor(now / 60);
    const istMM = String(now % 60).padStart(2, '0');

    // [TIME_CHECK] — verify we're inside the trading window
    log.debug(`[TIME_CHECK] IST ${istHH}:${istMM} window=${WINDOW_START_MINUTES}-${WINDOW_END_MINUTES}`);

    if (now < WINDOW_START_MINUTES) {
      return this.hold(`[TIME_CHECK] Before trading window (IST ${istHH}:${istMM} < 09:20)`);
    }
    if (now > WINDOW_END_MINUTES) {
      return this.hold(`[TIME_CHECK] After trading window (IST ${istHH}:${istMM} > 15:15)`);
    }

    // Need at least 3 completed candles to form the signal
    if (candles.length < 3) {
      return this.hold(`[PATTERN_SCAN] Not enough candles: ${candles.length} < 3`);
    }

    const n = candles.length;
    // c3 = most recent completed 5-min bar (entry = currentPrice ≈ close of c3 = open of next bar)
    // c2 = second most recent
    // c1 = oldest of the 3 signal candles
    const c3 = candles[n - 1]!; // most recent completed 5-min bar
    const c2 = candles[n - 2]!;
    const c1 = candles[n - 3]!; // oldest of the 3 signal candles

    // [PATTERN_SCAN] — log candle details for debugging
    log.debug('[PATTERN_SCAN] Candle analysis', {
      c1: { o: c1.open.toFixed(2), c: c1.close.toFixed(2), green: c1.close > c1.open },
      c2: { o: c2.open.toFixed(2), c: c2.close.toFixed(2), green: c2.close > c2.open },
      c3: { o: c3.open.toFixed(2), c: c3.close.toFixed(2), green: c3.close > c3.open },
      currentPrice,
      symbol: this.cfg.symbol,
    });

    const c1Green = c1.close > c1.open;
    const c2Green = c2.close > c2.open;
    const c3Green = c3.close > c3.open;

    const c1Red = c1.close < c1.open;
    const c2Red = c2.close < c2.open;
    const c3Red = c3.close < c3.open;

    // ── BUY signal: 3 consecutive GREEN candles ──────────────────────────────
    if (c1Green && c2Green && c3Green) {
      const entryPrice = currentPrice;       // open of next bar ≈ close of c3
      const stopLoss   = c1.open;            // Candle1 open as SL reference
      const target     = entryPrice * 1.02;  // +2%

      if (entryPrice <= stopLoss) {
        log.debug('[HOLD_REASON] BUY setup invalid: entry <= SL (price below candle1 open)', {
          entryPrice, stopLoss, symbol: this.cfg.symbol,
        });
        return this.hold('[HOLD_REASON] BUY setup invalid: entry <= SL (price below candle1 open)');
      }

      const reason =
        `3 consecutive GREEN candles — ` +
        `C1[${c1.open.toFixed(1)}→${c1.close.toFixed(1)}] ` +
        `C2[${c2.open.toFixed(1)}→${c2.close.toFixed(1)}] ` +
        `C3[${c3.open.toFixed(1)}→${c3.close.toFixed(1)}]`;

      log.info('[BUY_SIGNAL] generated', { symbol: this.cfg.symbol, entryPrice, stopLoss, target, reason });

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

    // ── SELL signal: 3 consecutive RED candles ───────────────────────────────
    if (c1Red && c2Red && c3Red) {
      const entryPrice = currentPrice;       // open of next bar ≈ close of c3
      const stopLoss   = c1.open;            // Candle1 open (above entry for short)
      const target     = entryPrice * 0.98;  // -2%

      // Validate: for SHORT, entry must be below c1.open (SL reference above)
      if (entryPrice >= stopLoss) {
        log.debug('[HOLD_REASON] SELL setup invalid: entry >= SL (price above candle1 open)', {
          entryPrice, stopLoss, symbol: this.cfg.symbol,
        });
        return this.hold('[HOLD_REASON] SELL setup invalid: entry >= SL (price above candle1 open)');
      }

      const reason =
        `3 consecutive RED candles — ` +
        `C1[${c1.open.toFixed(1)}→${c1.close.toFixed(1)}] ` +
        `C2[${c2.open.toFixed(1)}→${c2.close.toFixed(1)}] ` +
        `C3[${c3.open.toFixed(1)}→${c3.close.toFixed(1)}]`;

      log.info('[SELL_SIGNAL] generated', { symbol: this.cfg.symbol, entryPrice, stopLoss, target, reason });

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

    log.debug(`[HOLD] No 3-candle setup`, { pattern: summary, symbol: this.cfg.symbol });
    return this.hold(`[HOLD] No 3-candle setup — pattern: ${summary}`);
  }
}
