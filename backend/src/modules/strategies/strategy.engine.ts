import cron from 'node-cron';
import { prisma, redis } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { tradingService } from '../trading/trading.service';
import { paperEngine } from '../trading/paper-engine';
import { telegramService } from '../notifications/telegram.service';
import { EMACrossoverStrategy } from './ema-crossover.strategy';
import { RSIStrategy } from './rsi.strategy';
import { MACDStrategy } from './macd.strategy';
import { BreakoutStrategy } from './breakout.strategy';
import { CustomStrategy } from './custom.strategy';
import { ThreeCandleMomentumStrategy } from './three-candle-momentum.strategy';
import { BaseStrategy, StrategyConfig } from './base.strategy';
import { Candle, StrategySignal, StrategyRiskConfig, StrategyParams } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'StrategyEngine' });

type StrategyType = 'EMA_CROSSOVER' | 'RSI' | 'MACD' | 'BREAKOUT' | 'CUSTOM' | 'THREE_CANDLE_MOMENTUM';

const STRATEGY_CRON    = '*/5 9-15 * * 1-5';
const SQUAREOFF_CRON   = '25 15 * * 1-5';
const CRON_INTERVAL_MS = 5 * 60 * 1000;
const LOCK_TTL_SECONDS = 270; // 4.5 min — shorter than cron interval to avoid stranded locks
const LOCK_PREFIX      = 'lock:strategy-run:';

/**
 * Aggregate 1-minute candles into 5-minute candles using IST timestamp bucketing.
 * This correctly aligns bars to market session boundaries (9:15, 9:20, 9:25…)
 * regardless of when the oldest candle in the slice was recorded.
 */
function aggregateTo5Min(candles: Candle[]): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    // Shift UTC timestamp to IST (UTC+5:30) for bucketing
    const istMs = c.timestamp + 5.5 * 3_600_000;
    const d = new Date(istMs);
    const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const bucket = Math.floor(totalMin / 5) * 5; // align to 5-min boundary
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(c);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => ({
      timestamp: group[0]!.timestamp,
      open:      group[0]!.open,
      high:      Math.max(...group.map((c) => c.high)),
      low:       Math.min(...group.map((c) => c.low)),
      close:     group[group.length - 1]!.close,
      volume:    group.reduce((s, c) => s + c.volume, 0),
    }));
}

export class StrategyEngine {
  private jobs    = new Map<string, cron.ScheduledTask>();
  private configs = new Map<string, StrategyConfig & { isActive: boolean }>();
  private squareoffJob: cron.ScheduledTask | null = null;

  private buildStrategy(cfg: StrategyConfig): BaseStrategy {
    const map: Record<StrategyType, new (c: StrategyConfig) => BaseStrategy> = {
      EMA_CROSSOVER:          EMACrossoverStrategy,
      RSI:                    RSIStrategy,
      MACD:                   MACDStrategy,
      BREAKOUT:               BreakoutStrategy,
      CUSTOM:                 CustomStrategy,
      THREE_CANDLE_MOMENTUM:  ThreeCandleMomentumStrategy,
    };
    const Cls = map[cfg.type as StrategyType];
    if (!Cls) throw new Error(`Unknown strategy type: ${cfg.type}`);
    return new Cls(cfg);
  }

  /**
   * Distributed lock — only one PM2 cluster instance runs each strategy
   * per 5-minute cron bucket. TTL < cron interval so a crashed instance
   * never permanently blocks future ticks.
   */
  private async acquireRunLock(strategyId: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / CRON_INTERVAL_MS);
    const key    = `${LOCK_PREFIX}${strategyId}:${bucket}`;
    try {
      const result = await redis.set(key, `${process.pid}`, 'EX', LOCK_TTL_SECONDS, 'NX');
      return result === 'OK';
    } catch (err) {
      // Redis unavailable — fail open on single instance, alert loudly.
      log.error('Redis lock acquisition failed — proceeding without lock', { strategyId, err });
      return true;
    }
  }

  private async runStrategy(strategyId: string): Promise<void> {
    const masterSwitch = await prisma.setting.findUnique({ where: { key: 'strategies_enabled' } });
    if (masterSwitch?.value === 'false') {
      log.debug('Strategy engine master switch is OFF');
      return;
    }

    const dbRow = await prisma.strategy.findUnique({ where: { id: strategyId } });
    if (!dbRow || !dbRow.isActive) return;

    const acquired = await this.acquireRunLock(strategyId);
    if (!acquired) {
      log.debug('Skipping — lock held by another instance', { strategyId, pid: process.pid });
      return;
    }

    const cfg: StrategyConfig = {
      id:         dbRow.id,
      name:       dbRow.name,
      type:       dbRow.type,
      symbol:     dbRow.symbol,
      exchange:   dbRow.exchange,
      timeframe:  dbRow.timeframe,
      parameters: dbRow.parameters as StrategyParams,
      riskConfig: dbRow.riskConfig as unknown as StrategyRiskConfig,
      mode:       dbRow.mode as 'PAPER' | 'LIVE',
    };

    log.info('[STRATEGY_RUN] Started', { name: cfg.name, symbol: cfg.symbol, type: cfg.type, mode: cfg.mode });

    const strategy = this.buildStrategy(cfg);

    // ── Fetch and aggregate candles ──────────────────────────────────────────
    let candles: Candle[] = [];
    try {
      const raw = await upstoxClient.getIntradayCandles(cfg.symbol, '1minute');
      const oneMinCandles = raw
        .map((c) => ({
          timestamp: new Date(c[0] as string).getTime(),
          open:      c[1] as number,
          high:      c[2] as number,
          low:       c[3] as number,
          close:     c[4] as number,
          volume:    c[5] as number,
        }))
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-200); // fetch up to 200 1-min candles for more complete history
      candles = aggregateTo5Min(oneMinCandles);
      log.info('[CANDLES_OK] Fetched', { strategy: cfg.name, oneMin: oneMinCandles.length, fiveMin: candles.length });
    } catch (err) {
      log.error('Failed to fetch candles', { strategyId, symbol: cfg.symbol, err });
      return;
    }

    // Strategy-specific minimum candle threshold
    const minCandles = cfg.type === 'THREE_CANDLE_MOMENTUM' ? 3 : 5;
    if (candles.length < minCandles) {
      log.debug('Not enough candles', { strategyId, count: candles.length, required: minCandles });
      return;
    }

    const currentPrice = candles[candles.length - 1]!.close;
    log.info('[CANDLES_OK] Indicators ready', { strategy: cfg.name, currentPrice, candleCount: candles.length });

    // ── Run the strategy analysis FIRST, then check positions ───────────────
    const signal: StrategySignal = strategy.analyze(candles, currentPrice);

    log.info('[SIGNAL]', { strategy: cfg.name, type: signal.type, reason: signal.reason });

    if (signal.type === 'HOLD') {
      log.debug('[SIGNAL_IGNORED] HOLD', { name: cfg.name, reason: signal.reason });
      return;
    }

    // ── Position guard: allow opposite-direction signals (close existing) ─────
    const existingPosition = await prisma.position.findFirst({
      where: { symbol: cfg.symbol, mode: cfg.mode, isOpen: true },
    });
    if (existingPosition) {
      const existingSide = (existingPosition as { side?: string }).side ?? 'BUY';
      if (existingSide === signal.type) {
        log.debug('[SIGNAL_IGNORED] Same-direction position already open (no pyramid)', {
          strategy: cfg.name, symbol: cfg.symbol, existingSide, signalType: signal.type,
        });
        return;
      }
      // Opposite signal (e.g., SELL with open LONG) → fall through to close
      log.info('[SIGNAL] Opposite direction — will close existing position', {
        strategy: cfg.name, existingSide, signalType: signal.type,
      });
    }

    log.info('[SIGNAL] Generated', {
      strategy: cfg.name, signal: signal.type, price: signal.price,
      sl: signal.stopLoss, target: signal.target, reason: signal.reason,
    });

    // Persist signal
    const dbSignal = await prisma.signal.create({
      data: {
        strategyId: cfg.id,
        symbol:     cfg.symbol,
        action:     signal.type,
        price:      signal.price,
        reason:     signal.reason,
        indicators: signal.indicators as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    await telegramService.notifySignal(cfg.name, signal.type, cfg.symbol, signal.price, signal.stopLoss, signal.target);

    // Find active trader/admin to attribute the order to
    const user = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'TRADER'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      log.warn('No active trader found — signal not executed', { strategy: cfg.name });
      return;
    }

    const maxValue = cfg.riskConfig.maxPositionValue;
    const qty = Math.max(1, Math.floor(maxValue / signal.price));

    try {
      await tradingService.placeOrder(
        user.id,
        {
          symbol:          cfg.symbol,
          exchange:        cfg.exchange,
          instrumentToken: cfg.symbol,
          side:            signal.type as 'BUY' | 'SELL',
          qty,
          orderType:       'MARKET',
          product:         'MIS',
          stopLoss:        signal.stopLoss,
          target:          signal.target,
          strategyId:      cfg.id,
          tag:             `STRATEGY_${cfg.type}`,
        },
        signal.price,
        cfg.mode, // <— use strategy-level mode, not global setting
      );

      await prisma.signal.update({ where: { id: dbSignal.id }, data: { isExecuted: true } });
      log.info('[ORDER_PLACED]', {
        strategy: cfg.name, side: signal.type, qty, price: signal.price, mode: cfg.mode,
      });
    } catch (err) {
      log.error('Strategy order failed', { strategy: cfg.name, err });
      await telegramService.notify(`❌ Order failed for ${cfg.name}: ${(err as Error).message}`);
    }
  }

  // ─── Start / Stop individual strategy ────────────────────────────────────────
  async startStrategy(strategyId: string): Promise<void> {
    if (this.jobs.has(strategyId)) {
      log.warn('Strategy already running', { strategyId });
      return;
    }

    const row = await prisma.strategy.findUnique({ where: { id: strategyId } });
    if (!row) throw new Error(`Strategy ${strategyId} not found`);

    const job = cron.schedule(
      STRATEGY_CRON,
      () => this.runStrategy(strategyId).catch((e) => log.error('Strategy run error', { strategyId, e })),
      { scheduled: true, timezone: 'Asia/Kolkata' },
    );

    this.jobs.set(strategyId, job);
    this.configs.set(strategyId, {
      id:         row.id,
      name:       row.name,
      type:       row.type,
      symbol:     row.symbol,
      exchange:   row.exchange,
      timeframe:  row.timeframe,
      parameters: row.parameters as StrategyParams,
      riskConfig: row.riskConfig as unknown as StrategyRiskConfig,
      mode:       row.mode as 'PAPER' | 'LIVE',
      isActive:   true,
    });

    log.info('Strategy started', { name: row.name, cron: STRATEGY_CRON });
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

  // ─── Force squareoff all open paper positions at 15:25 ───────────────────────
  private startSquareoffJob(): void {
    if (this.squareoffJob) return;
    this.squareoffJob = cron.schedule(
      SQUAREOFF_CRON,
      async () => {
        log.info('EOD force squareoff cron triggered');
        try {
          await paperEngine.forceSquareoff();
        } catch (err) {
          log.error('Force squareoff failed', { err });
        }
      },
      { scheduled: true, timezone: 'Asia/Kolkata' },
    );
    log.info('EOD squareoff job scheduled', { cron: SQUAREOFF_CRON });
  }

  // ─── Price tick (from WebSocket) ─────────────────────────────────────────────
  onPriceTick(symbol: string, price: number): void {
    void price;
    Array.from(this.configs.values())
      .filter((cfg) => cfg.symbol === symbol && cfg.isActive)
      .forEach((cfg) => {
        void this.runStrategy(cfg.id).catch(() => void 0);
      });
  }

  // ─── Start all active strategies on boot ─────────────────────────────────────
  async startAll(): Promise<void> {
    const active = await prisma.strategy.findMany({ where: { isActive: true } });
    await Promise.all(active.map((s) => this.startStrategy(s.id).catch((e) => log.error('Start error', { id: s.id, e }))));
    this.startSquareoffJob();
    log.info(`Strategy engine: ${active.length} strategies started`);
  }

  async stopAll(): Promise<void> {
    for (const [, job] of this.jobs) job.stop();
    this.jobs.clear();
    this.configs.clear();
    if (this.squareoffJob) {
      this.squareoffJob.stop();
      this.squareoffJob = null;
    }
    log.info('All strategies stopped');
  }

  runningIds(): string[] {
    return Array.from(this.jobs.keys());
  }
}

export const strategyEngine = new StrategyEngine();
