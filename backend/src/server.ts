import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { prisma, redis } from './database/client';
import { logger } from './utils/logger';
import { WebSocketService } from './modules/market-data/websocket.service';
import { strategyEngine } from './modules/strategies/strategy.engine';
import { s3Service } from './modules/s3/s3.service';
import { riskManager } from './modules/risk/risk-manager';
import { telegramService } from './modules/notifications/telegram.service';

const log = logger.child({ category: 'Server' });

async function bootstrap(): Promise<void> {
  // ─── Database ─────────────────────────────────────────────────────────────
  await prisma.$connect();
  log.info('PostgreSQL connected');

  // ─── Redis ────────────────────────────────────────────────────────────────
  await redis.ping();
  log.info('Redis connected');

  // ─── S3 (optional — graceful if not configured) ───────────────────────────
  if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY && config.AWS_S3_BUCKET) {
    const ok = await s3Service.verifyBucket();
    log.info(ok ? 'S3 bucket verified' : 'S3 bucket unreachable — S3 features disabled');
  } else {
    log.warn('AWS credentials not configured — S3 features disabled');
  }

  // ─── HTTP + WebSocket ─────────────────────────────────────────────────────
  const app = createApp();
  const server = http.createServer(app);
  const wsService = new WebSocketService(server);
  (global as Record<string, unknown>).wsService = wsService;

  // ─── Strategy engine ──────────────────────────────────────────────────────
  await strategyEngine.startAll();
  log.info('Strategy engine started');

  // ─── Risk manager — schedule midnight reset ───────────────────────────────
  riskManager.scheduleDailyReset();

  // ─── Upstox market feed (active strategies' symbols) ─────────────────────
  try {
    const activeStrategies = await prisma.strategy.findMany({ where: { isActive: true } });
    const symbols = [...new Set(
      activeStrategies.flatMap((s) => [s.symbol, ...(s.watchedSymbols ?? [])]).filter(Boolean),
    )] as string[];
    if (symbols.length) {
      await wsService.connectUpstoxFeed(symbols);
      log.info('Upstox market feed connected', { symbols });
    }
  } catch (err) {
    log.warn('Could not start Upstox feed (token may not be set yet)', { err });
  }

  // ─── Listen ───────────────────────────────────────────────────────────────
  server.listen(config.PORT, () => {
    log.info(`AlgoTrader API listening`, { port: config.PORT, env: config.NODE_ENV });
    telegramService.notify(`AlgoTrader started on port ${config.PORT} (${config.NODE_ENV})`).catch(() => void 0);
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received — shutting down gracefully`);
    strategyEngine.stopAll();
    wsService.close();
    server.close(async () => {
      await prisma.$disconnect();
      await redis.quit();
      log.info('All connections closed — exiting');
      process.exit(0);
    });
    // Force-kill after 15s
    setTimeout(() => { log.error('Forced exit after timeout'); process.exit(1); }, 15_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { err });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason });
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
