import { BaseStrategy } from './base.strategy';
import { Candle, StrategySignal } from '../../types';
import { rollingHigh, rollingLow, avgVolume, calcATR } from '../../utils/indicators';

export class BreakoutStrategy extends BaseStrategy {
  analyze(candles: Candle[], currentPrice: number): StrategySignal {
    const { lookback = 20, volumeMultiplier = 1.5 } = this.cfg.parameters;
    const lb = lookback as number;
    const vm = volumeMultiplier as number;

    if (candles.length < lb + 3) {
      return this.hold(`Need ${lb + 3} candles, have ${candles.length}`);
    }

    // Use all candles except the current one for historical levels
    const historical = candles.slice(0, -1);
    const current = candles[candles.length - 1]!;

    const resistance = rollingHigh(historical, lb);
    const support = rollingLow(historical, lb);
    const atr = calcATR(candles, 14);
    const volAvg = avgVolume(historical, lb);
    const currentVol = current.volume;

    const volumeConfirmed = currentVol > volAvg * vm;

    const indicators = {
      resistance: Number(resistance.toFixed(2)),
      support: Number(support.toFixed(2)),
      atr: Number(atr.toFixed(2)),
      currentVolume: currentVol,
      avgVolume: Number(volAvg.toFixed(0)),
      volumeRatio: Number((currentVol / volAvg).toFixed(2)),
    };

    // Breakout above resistance with volume confirmation
    if (currentPrice > resistance && volumeConfirmed) {
      const strength = Math.min((currentPrice - resistance) / atr, 1);
      return this.signal(
        'BUY',
        currentPrice,
        `Breakout above ${lb}-period high ₹${resistance.toFixed(2)} with ${(currentVol / volAvg).toFixed(1)}x volume`,
        indicators,
        strength,
      );
    }

    // Breakdown below support with volume confirmation
    if (currentPrice < support && volumeConfirmed) {
      const strength = Math.min((support - currentPrice) / atr, 1);
      return this.signal(
        'SELL',
        currentPrice,
        `Breakdown below ${lb}-period low ₹${support.toFixed(2)} with ${(currentVol / volAvg).toFixed(1)}x volume`,
        indicators,
        strength,
      );
    }

    return this.hold(`In range ₹${support.toFixed(2)}–₹${resistance.toFixed(2)}, vol=${volumeConfirmed ? 'ok' : 'low'}`, indicators);
  }
}
