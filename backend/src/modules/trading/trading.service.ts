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

  // ─── Phase 6: Analytics ───────────────────────────────────────────────────────
  async getAnalytics(userId: string, mode?: TradingMode, days = 30) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);

    const tradeWhere = {
      order: { userId },
      ...(mode ? { mode } : {}),
      createdAt: { gte: fromDate },
      exitPrice: { not: null }, // only closed trades
    };

    const allTrades = await prisma.trade.findMany({
      where: tradeWhere,
      orderBy: { createdAt: 'asc' },
    });

    // Daily PnL grouping
    const dailyPnlMap = new Map<string, number>();
    for (const t of allTrades) {
      const dateKey = t.createdAt.toISOString().substring(0, 10);
      dailyPnlMap.set(dateKey, (dailyPnlMap.get(dateKey) ?? 0) + (t.pnl ?? 0));
    }
    const dailyPnl = Array.from(dailyPnlMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pnl]) => ({ date, pnl }));

    const wins   = allTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losses = allTrades.filter((t) => (t.pnl ?? 0) <= 0);
    const totalPnl  = allTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate   = allTrades.length ? (wins.length / allTrades.length) * 100 : 0;
    const avgWin    = wins.length    ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0)    / wins.length   : 0;
    const avgLoss   = losses.length  ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0)  / losses.length : 0;
    const bestTrade = allTrades.reduce((b, t) => ((t.pnl ?? 0) > (b?.pnl ?? -Infinity) ? t : b), allTrades[0]);
    const worstTrade = allTrades.reduce((w, t) => ((t.pnl ?? 0) < (w?.pnl ?? Infinity) ? t : w), allTrades[0]);

    // Monthly returns
    const monthlyMap = new Map<string, number>();
    for (const t of allTrades) {
      const month = t.createdAt.toISOString().substring(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (t.pnl ?? 0));
    }
    const monthlyReturns = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, pnl]) => ({ month, pnl }));

    return {
      period: { days, from: fromDate.toISOString().substring(0, 10) },
      totalTrades: allTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      avgWin,
      avgLoss,
      bestTrade:  bestTrade?.pnl  ?? null,
      worstTrade: worstTrade?.pnl ?? null,
      dailyPnl,
      monthlyReturns,
    };
  }
}

export const tradingService = new TradingService();
