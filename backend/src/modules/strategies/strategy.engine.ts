import cron from 'node-cron';
import { prisma } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { tradingService } from '../trading/trading.service';
import { telegramService } from '../notifications/telegram.service';
import { EMACrossoverStrategy } from './ema-crossover.strategy';
import { RSIStrategy } from './rsi.strategy';
import { MACDStrategy } from './macd.strategy';
import { BreakoutStrategy } from './breakout.strategy';
import { CustomStrategy } from './custom.strategy';
import { BaseStrategy, StrategyConfig } from './base.strategy';
import { Candle, StrategySignal, StrategyRiskConfig, StrategyParams } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'StrategyEngine' });

type StrategyType = 'EMA_CROSSOVER' | 'RSI' | 'MACD' | 'BREAKOUT' | 'CUSTOM';

const TIMEFRAME_CRON: Record<string, string> = {
  '1minute':  '*/1 9-15 * * 1-5',
  '3minute':  '*/3 9-15 * * 1-5',
  '5minute':  '*/5 9-15 * * 1-5',
  '10minute': '*/10 9-15 * * 1-5',
  '15minute': '*/15 9-15 * * 1-5',
  '30minute': '*/30 9-15 * * 1-5',
  '1hour':    '0 9-15 * * 1-5',
};

export class StrategyEngine {
  private jobs = new Map<string, cron.ScheduledTask>();
  private configs = new Map<string, StrategyConfig & { isActive: boolean }>();

  private buildStrategy(cfg: StrategyConfig): BaseStrategy {
    const map: Record<StrategyType, new (c: StrategyConfig) => BaseStrategy> = {
      EMA_CROSSOVER: EMACrossoverStrategy,
      RSI:           RSIStrategy,
      MACD:          MACDStrategy,
      BREAKOUT:      BreakoutStrategy,
      CUSTOM:        CustomStrategy,
    };
    const Cls = map[cfg.type as StrategyType];
    if (!Cls) throw new Error(`Unknown strategy type: ${cfg.type}`);
    return new Cls(cfg);
  }

  private async runStrategy(strategyId: string): Promise<void> {
    const dbRow = await prisma.strategy.findUnique({ where: { id: strategyId } });
    if (!dbRow || !dbRow.isActive) return;

    const cfg: StrategyConfig = {
      id: dbRow.id,
      name: dbRow.name,
      type: dbRow.type,
      symbol: dbRow.symbol,
      exchange: dbRow.exchange,
      timeframe: dbRow.timeframe,
      parameters: dbRow.parameters as StrategyParams,
      riskConfig: dbRow.riskConfig as unknown as StrategyRiskConfig,
      mode: dbRow.mode as 'PAPER' | 'LIVE',
    };

    const strategy = this.buildStrategy(cfg);

    // Fetch historical candles
    const today = new Date().toISOString().split('T')[0]!;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]!;

    let candles: Candle[] = [];
    try {
      const raw = cfg.timeframe.includes('minute')
        ? await upstoxClient.getIntradayCandles(cfg.symbol, cfg.timeframe)
        : await upstoxClient.getHistoricalCandles(cfg.symbol, cfg.timeframe, today, yesterday);
      candles = raw
        .map((c) => ({
          timestamp: new Date(c[0] as string).getTime(),
          open: c[1] as number,
          high: c[2] as number,
          low: c[3] as number,
          close: c[4] as number,
          volume: c[5] as number,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      log.error('Failed to fetch candles', { strategyId, err });
      return;
    }

    if (candles.length < 5) {
      log.debug('Not enough candles', { strategyId, count: candles.length });
      return;
    }

    const currentPrice = candles[candles.length - 1]!.close;
    const signal: StrategySignal = strategy.analyze(candles, currentPrice);

    if (signal.type === 'HOLD') {
      log.debug('Strategy HOLD', { name: cfg.name, reason: signal.reason });
      return;
    }

    // Persist signal
    const dbSignal = await prisma.signal.create({
      data: {
        strategyId: cfg.id,
        symbol: cfg.symbol,
        action: signal.type,
        price: signal.price,
        reason: signal.reason,
        indicators: signal.indicators as any,
      },
    });

    log.info('Signal generated', { strategy: cfg.name, signal: signal.type, price: signal.price });

    // Telegram notification
    await telegramService.notify(
      `📊 *${signal.type}* Signal — ${cfg.name}\n` +
      `Symbol: ${cfg.symbol}\n` +
      `Price: ₹${signal.price.toFixed(2)}\n` +
      `Reason: ${signal.reason}\n` +
      `Stop Loss: ₹${signal.stopLoss?.toFixed(2)}\n` +
      `Target: ₹${signal.target?.toFixed(2)}`,
    );

    // Find an active trader/admin to attribute the order to
    const user = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'TRADER'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) { log.warn('No active trader found — signal not executed'); return; }

    // Check position sizing
    const maxValue = cfg.riskConfig.maxPositionValue;
    const qty = Math.max(1, Math.floor(maxValue / signal.price));

    try {
      await tradingService.placeOrder(user.id, {
        symbol: cfg.symbol,
        exchange: cfg.exchange,
        instrumentToken: cfg.symbol,
        side: signal.type as 'BUY' | 'SELL',
        qty,
        orderType: 'MARKET',
        product: 'MIS',
        stopLoss: signal.stopLoss,
        target: signal.target,
        strategyId: cfg.id,
        tag: `STRATEGY_${cfg.type}`,
      }, signal.price);

      await prisma.signal.update({ where: { id: dbSignal.id }, data: { isExecuted: true } });
      log.info('Strategy order placed', { strategy: cfg.name, qty, price: signal.price });
    } catch (err) {
      log.error('Strategy order failed', { strategy: cfg.name, err });
      await telegramService.notify(`❌ Order failed for ${cfg.name}: ${(err as Error).message}`);
    }
  }

  async startStrategy(strategyId: string): Promise<void> {
    if (this.jobs.has(strategyId)) {
      log.warn('Strategy already running', { strategyId });
      return;
    }

    const row = await prisma.strategy.findUnique({ where: { id: strategyId } });
    if (!row) throw new Error(`Strategy ${strategyId} not found`);

    const cronExpr = TIMEFRAME_CRON[row.timeframe] ?? '*/5 9-15 * * 1-5';
    const job = cron.schedule(
      cronExpr,
      () => this.runStrategy(strategyId).catch((e) => log.error('Strategy run error', { strategyId, e })),
      { scheduled: true, timezone: 'Asia/Kolkata' },
    );

    this.jobs.set(strategyId, job);
    this.configs.set(strategyId, {
      id: row.id,
      name: row.name,
      type: row.type,
      symbol: row.symbol,
      exchange: row.exchange,
      timeframe: row.timeframe,
      parameters: row.parameters as StrategyParams,
      riskConfig: row.riskConfig as unknown as StrategyRiskConfig,
      mode: row.mode as 'PAPER' | 'LIVE',
      isActive: true,
    });
    log.info('Strategy started', { name: row.name, cron: cronExpr });
  }

  async stopStrategy(strategyId: string): Promise<void> {
    const job = this.jobs.get(strategyId);
    if (job) {
      job.stop();
      this.jobs.delete(strategyId);
      this.configs.delete(strategyId);
      log.info('Strategy stopped', { strategyId });
    }
  }

  onPriceTick(symbol: string, price: number): void {
    // Run strategies that have this symbol when live price arrives
    void price;
    Array.from(this.configs.values())
      .filter((cfg) => cfg.symbol === symbol && cfg.isActive)
      .forEach((cfg) => {
        void this.runStrategy(cfg.id).catch(() => void 0);
      });
  }

  async startAll(): Promise<void> {
    const active = await prisma.strategy.findMany({ where: { isActive: true } });
    await Promise.all(active.map((s) => this.startStrategy(s.id).catch((e) => log.error('Start error', { id: s.id, e }))));
    log.info(`Strategy engine: ${active.length} strategies started`);
  }

  async stopAll(): Promise<void> {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
    log.info('All strategies stopped');
  }

  runningIds(): string[] {
    return Array.from(this.jobs.keys());
  }
}

export const strategyEngine = new StrategyEngine();
