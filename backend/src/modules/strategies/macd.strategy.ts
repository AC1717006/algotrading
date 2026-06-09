import { BaseStrategy } from './base.strategy';
import { Candle, StrategySignal } from '../../types';
import { calcMACD, last, prev } from '../../utils/indicators';

export class MACDStrategy extends BaseStrategy {
  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = this.cfg.parameters;
    const minCandles = (slowPeriod as number) + (signalPeriod as number) + 3;

    if (candles.length < minCandles) {
      return this.hold(`Need ${minCandles} candles, have ${candles.length}`);
    }

    const macdData = calcMACD(candles, fastPeriod as number, slowPeriod as number, signalPeriod as number);
    if (macdData.length < 2) return this.hold('MACD array too short');

    const curr = last(macdData);
    const prevBar = prev(macdData);

    if (curr.MACD === undefined || curr.signal === undefined || prevBar.MACD === undefined || prevBar.signal === undefined) {
      return this.hold('MACD values not available yet');
    }

    const indicators = {
      macd: Number(curr.MACD.toFixed(4)),
      signal: Number(curr.signal.toFixed(4)),
      histogram: Number((curr.histogram ?? 0).toFixed(4)),
    };

    // Bullish cross below zero line
    const bullishCross = prevBar.MACD <= prevBar.signal && curr.MACD > curr.signal && curr.MACD < 0;
    if (bullishCross) {
      const strength = Math.min(Math.abs(curr.histogram ?? 0) * 100, 1);
      return this.signal('BUY', currentPrice, `MACD crossed above signal below zero line (histogram: ${curr.histogram?.toFixed(4)})`, indicators, strength);
    }

    // Bearish cross above zero line
    const bearishCross = prevBar.MACD >= prevBar.signal && curr.MACD < curr.signal && curr.MACD > 0;
    if (bearishCross) {
      const strength = Math.min(Math.abs(curr.histogram ?? 0) * 100, 1);
      return this.signal('SELL', currentPrice, `MACD crossed below signal above zero line (histogram: ${curr.histogram?.toFixed(4)})`, indicators, strength);
    }

    return this.hold(`MACD=${curr.MACD.toFixed(4)} Signal=${curr.signal.toFixed(4)}`, indicators);
  }
}
