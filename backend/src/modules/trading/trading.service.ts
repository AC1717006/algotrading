import { prisma } from '../../database/client';
import { paperEngine } from './paper-engine';
import { liveEngine } from './live-engine';
import { AppError } from '../../middleware/errorHandler';
import { PlaceOrderRequest, TradingMode } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'TradingService' });

export class TradingService {
  async getCurrentMode(): Promise<TradingMode> {
    const setting = await prisma.setting.findUnique({ where: { key: 'trading_mode' } });
    return (setting?.value as TradingMode) ?? 'PAPER';
  }

  async setMode(mode: TradingMode): Promise<void> {
    await prisma.setting.update({ where: { key: 'trading_mode' }, data: { value: mode } });
    log.info('Trading mode switched', { mode });
  }

  async placeOrder(
    userId: string,
    req: PlaceOrderRequest,
    currentPrice: number,
    modeOverride?: TradingMode,
  ): Promise<{ orderId: string; mode: TradingMode }> {
    const mode = modeOverride ?? await this.getCurrentMode();
    let result: { orderId: string };

    if (mode === 'PAPER') {
      result = await paperEngine.placeOrder(userId, req, currentPrice);
    } else {
      result = await liveEngine.placeOrder(userId, req, currentPrice);
    }

    return { ...result, mode };
  }

  async cancelOrder(orderId: string, userId: string): Promise<void> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.userId !== userId) throw new AppError(403, 'Access denied');
    if (!['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(order.status)) {
      throw new AppError(400, `Cannot cancel order with status: ${order.status}`);
    }

    if (order.mode === 'LIVE') {
      await liveEngine.cancelOrder(orderId);
    } else {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    }
  }

  async getOrders(
    userId: string,
    filters: { mode?: TradingMode; status?: string; symbol?: string; limit?: number; offset?: number },
  ) {
    const where = {
      userId,
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.status ? { status: filters.status as 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' } : {}),
      ...(filters.symbol ? { symbol: { contains: filters.symbol, mode: 'insensitive' as const } } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { placedAt: 'desc' }, take: filters.limit ?? 100, skip: filters.offset ?? 0 }),
      prisma.order.count({ where }),
    ]);

    return { orders, total };
  }

  async getTrades(
    userId: string,
    filters: { mode?: TradingMode; symbol?: string; limit?: number; offset?: number },
  ) {
    const where = {
      order: { userId },
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.symbol ? { symbol: { contains: filters.symbol, mode: 'insensitive' as const } } : {}),
    };

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({ where, orderBy: { createdAt: 'desc' }, take: filters.limit ?? 100, skip: filters.offset ?? 0 }),
      prisma.trade.count({ where }),
    ]);

    // Compute summary
    const winningTrades = trades.filter((t) => (t.pnl ?? 0) > 0);
    const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const bestTrade = trades.reduce((best, t) => ((t.pnl ?? 0) > (best?.pnl ?? -Infinity) ? t : best), trades[0]);
    const worstTrade = trades.reduce((worst, t) => ((t.pnl ?? 0) < (worst?.pnl ?? Infinity) ? t : worst), trades[0]);

    return {
      trades,
      total,
      summary: {
        totalTrades: trades.length,
        winRate: trades.length ? (winningTrades.length / trades.length) * 100 : 0,
        totalPnl,
        bestTrade: bestTrade?.pnl ?? null,
        worstTrade: worstTrade?.pnl ?? null,
      },
    };
  }

  async getPositions(mode?: TradingMode) {
    return prisma.position.findMany({
      where: { isOpen: true, ...(mode ? { mode } : {}) },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getDashboardSummary(userId: string) {
    const mode = await this.getCurrentMode();
    const [paperSummary, liveDailyPnl, positions, activeStrategies] = await Promise.all([
      paperEngine.getSummary(userId),
      liveEngine.getDailyPnL(userId),
      this.getPositions(),
      prisma.strategy.count({ where: { isActive: true } }),
    ]);

    const totalPnl = paperSummary.dailyPnl + liveDailyPnl;
    const openPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

    return {
      mode,
      paperBalance: paperSummary.balance,
      dailyPnl: totalPnl,
      unrealizedPnl: openPnl,
      openPositions: positions.length,
      activeStrategies,
      circuitBreakerActive: false,
    };
  }
}

export const tradingService = new TradingService();
