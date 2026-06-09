import { Candle, StrategySignal, StrategyRiskConfig, StrategyParams } from '../../types';

export interface StrategyConfig {
  id: string;
  name: string;
  type: string;
  symbol: string;
  exchange: string;
  timeframe: string;
  parameters: StrategyParams;
  riskConfig: StrategyRiskConfig;
  mode: 'PAPER' | 'LIVE';
}

export abstract class BaseStrategy {
  constructor(protected readonly cfg: StrategyConfig) {}

  abstract analyze(candles: Candle[], currentPrice: number): StrategySignal;

  protected hold(reason: string, indicators: Record<string, number | string> = {}): StrategySignal {
    return {
      type: 'HOLD',
      symbol: this.cfg.symbol,
      exchange: this.cfg.exchange,
      price: 0,
      strength: 0,
      reason,
      indicators,
    };
  }

  protected signal(
    type: 'BUY' | 'SELL',
    price: number,
    reason: string,
    indicators: Record<string, number | string>,
    strength = 1.0,
  ): StrategySignal {
    const pct = this.cfg.riskConfig;
    const stopLoss = type === 'BUY'
      ? price * (1 - pct.stopLossPercent / 100)
      : price * (1 + pct.stopLossPercent / 100);
    const target = type === 'BUY'
      ? price * (1 + pct.targetPercent / 100)
      : price * (1 - pct.targetPercent / 100);

    return { type, symbol: this.cfg.symbol, exchange: this.cfg.exchange, price, strength, reason, indicators, stopLoss, target };
  }
}
