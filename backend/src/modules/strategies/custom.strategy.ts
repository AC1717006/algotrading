import { BaseStrategy } from './base.strategy';
import { Candle, StrategySignal } from '../../types';
import { calcEMA, calcRSI, calcMACD, last, prev } from '../../utils/indicators';

/**
 * Custom composite strategy:
 *   1. EMA trend filter — price must be above/below a slow EMA
 *   2. RSI entry signal — oversold/overbought zone entry
 *   3. MACD confirmation — histogram direction must agree
 */
export class CustomStrategy extends BaseStrategy {
  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const {
      emaTrend = 50,
      rsiPeriod = 14,
      rsiOversold = 40,
      rsiOverbought = 60,
      fastPeriod = 12,
      slowPeriod = 26,
      signalPeriod = 9,
    } = this.cfg.parameters;

    const minCandles = Math.max(emaTrend as number, (slowPeriod as number) + (signalPeriod as number)) + 5;
    if (candles.length < minCandles) {
      return this.hold(`Need ${minCandles} candles, have ${candles.length}`);
    }

    const trendEma = calcEMA(candles, emaTrend as number);
    const rsiValues = calcRSI(candles, rsiPeriod as number);
    const macdData = calcMACD(candles, fastPeriod as number, slowPeriod as number, signalPeriod as number);

    if (!trendEma.length || rsiValues.length < 2 || !macdData.length) {
      return this.hold('Indicator data insufficient');
    }

    const trend = last(trendEma);
    const rsiNow = last(rsiValues);
    const rsiPrev = prev(rsiValues);
    const macdNow = last(macdData);
    const macdPrev = prev(macdData);

    const aboveTrend = currentPrice > trend;
    const belowTrend = currentPrice < trend;
    const macdBullish = (macdNow.histogram ?? 0) > (macdPrev.histogram ?? 0); // histogram rising
    const macdBearish = (macdNow.histogram ?? 0) < (macdPrev.histogram ?? 0); // histogram falling

    const indicators = {
      trendEma: Number(trend.toFixed(2)),
      rsi: Number(rsiNow.toFixed(2)),
      macdHistogram: Number((macdNow.histogram ?? 0).toFixed(4)),
    };

    // BUY: price above trend EMA, RSI crosses out of oversold, MACD histogram rising
    const rsiBullish = rsiPrev < (rsiOversold as number) && rsiNow >= (rsiOversold as number);
    if (aboveTrend && rsiBullish && macdBullish) {
      const strength = ((rsiOversold as number) - Math.min(rsiPrev, rsiOversold as number)) / (rsiOversold as number);
      return this.signal(
        'BUY',
        currentPrice,
        `EMA${emaTrend} trend bullish + RSI(${rsiNow.toFixed(1)}) exits oversold + MACD rising`,
        indicators,
        strength,
      );
    }

    // SELL: price below trend EMA, RSI crosses out of overbought, MACD histogram falling
    const rsiBearish = rsiPrev > (rsiOverbought as number) && rsiNow <= (rsiOverbought as number);
    if (belowTrend && rsiBearish && macdBearish) {
      const strength = (Math.max(rsiPrev, rsiOverbought as number) - (rsiOverbought as number)) / (100 - (rsiOverbought as number));
      return this.signal(
        'SELL',
        currentPrice,
        `EMA${emaTrend} trend bearish + RSI(${rsiNow.toFixed(1)}) exits overbought + MACD falling`,
        indicators,
        strength,
      );
    }

    return this.hold(
      `${aboveTrend ? 'Above' : 'Below'} EMA${emaTrend}, RSI=${rsiNow.toFixed(1)}, MACD=${macdNow.histogram?.toFixed(4)}`,
      indicators,
    );
  }
}
