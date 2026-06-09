import { BaseStrategy } from './base.strategy';
import { Candle, StrategySignal } from '../../types';
import { calcRSI, last, prev } from '../../utils/indicators';

export class RSIStrategy extends BaseStrategy {
  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const { period = 14, oversold = 30, overbought = 70 } = this.cfg.parameters;

    if (candles.length < (period as number) + 3) {
      return this.hold(`Need ${(period as number) + 3} candles, have ${candles.length}`);
    }

    const rsiValues = calcRSI(candles, period as number);
    if (rsiValues.length < 2) return this.hold('RSI array too short');

    const rsiNow = last(rsiValues);
    const rsiPrev = prev(rsiValues);

    const indicators = { rsi: Number(rsiNow.toFixed(2)), prevRsi: Number(rsiPrev.toFixed(2)) };

    // Oversold reversal → BUY
    if (rsiPrev < (oversold as number) && rsiNow >= (oversold as number)) {
      const strength = ((oversold as number) - rsiPrev) / (oversold as number);
      return this.signal('BUY', currentPrice, `RSI crossed above ${oversold} (oversold reversal: ${rsiNow.toFixed(1)})`, indicators, strength);
    }

    // Overbought reversal → SELL
    if (rsiPrev > (overbought as number) && rsiNow <= (overbought as number)) {
      const strength = (rsiPrev - (overbought as number)) / (100 - (overbought as number));
      return this.signal('SELL', currentPrice, `RSI crossed below ${overbought} (overbought reversal: ${rsiNow.toFixed(1)})`, indicators, strength);
    }

    return this.hold(`RSI=${rsiNow.toFixed(1)} — between ${oversold} and ${overbought}`, indicators);
  }
}
