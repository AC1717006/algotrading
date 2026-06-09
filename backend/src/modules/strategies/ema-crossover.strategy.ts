import { BaseStrategy } from './base.strategy';
import { Candle, StrategySignal } from '../../types';
import { calcEMA, last, prev } from '../../utils/indicators';

export class EMACrossoverStrategy extends BaseStrategy {
  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const { fastPeriod = 9, slowPeriod = 21 } = this.cfg.parameters;

    if (candles.length < (slowPeriod as number) + 3) {
      return this.hold(`Need ${(slowPeriod as number) + 3} candles, have ${candles.length}`);
    }

    const fastEma = calcEMA(candles, fastPeriod as number);
    const slowEma = calcEMA(candles, slowPeriod as number);

    if (fastEma.length < 2 || slowEma.length < 2) {
      return this.hold('EMA arrays too short');
    }

    const fastNow = last(fastEma);
    const fastPrev = prev(fastEma);
    const slowNow = last(slowEma);
    const slowPrev = prev(slowEma);

    const indicators = {
      fastEma: Number(fastNow.toFixed(2)),
      slowEma: Number(slowNow.toFixed(2)),
      spread: Number((fastNow - slowNow).toFixed(2)),
    };

    // Bullish crossover: fast crosses above slow
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      const strength = Math.min(Math.abs(fastNow - slowNow) / slowNow, 1);
      return this.signal('BUY', currentPrice, `EMA${fastPeriod} crossed above EMA${slowPeriod}`, indicators, strength);
    }

    // Bearish crossover: fast crosses below slow
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      const strength = Math.min(Math.abs(slowNow - fastNow) / slowNow, 1);
      return this.signal('SELL', currentPrice, `EMA${fastPeriod} crossed below EMA${slowPeriod}`, indicators, strength);
    }

    return this.hold(`EMA${fastPeriod}=${fastNow.toFixed(2)} vs EMA${slowPeriod}=${slowNow.toFixed(2)}`, indicators);
  }
}
