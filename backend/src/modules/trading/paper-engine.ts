import { prisma } from '../../database/client';
import { riskManager } from '../risk/risk-manager';
import { telegramService } from '../notifications/telegram.service';
import { AppError } from '../../middleware/errorHandler';
import { PlaceOrderRequest } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'PaperEngine' });
const BROKERAGE = 0.0003; // 0.03% per leg

export class PaperTradingEngine {
  // ─── Balance ─────────────────────────────────────────────────────────────────
  async getBalance(userId: string): Promise<number> {
    const key = `paper_balance_${userId}`;
    const setting = await prisma.setting.findUnique({ where: { key } });
    if (setting) return Number(setting.value);
    // Fall back to global default
    const global = await prisma.setting.findUnique({ where: { key: 'paper_balance' } });
    return Number(global?.value ?? 1_000_000);
  }

  private async adjustBalance(userId: string, delta: number): Promise<number> {
    const key = `paper_balance_${userId}`;
    const current = await this.getBalance(userId);
    const next = current + delta;
    await prisma.setting.upsert({
      where: { key },
      update: { value: String(next) },
      create: { key, value: String(next), description: `Paper balance for user ${userId}` },
    });
    return next;
  }

  // ─── Place order ─────────────────────────────────────────────────────────────
  async placeOrder(
    userId: string,
    req: PlaceOrderRequest,
    currentPrice: number,
  ): Promise<{ orderId: string; tradeId?: string }> {
    const balance = await this.getBalance(userId);

    if (!req.qty || req.qty < 1) {
      const defaultQty = await prisma.setting.findUnique({ where: { key: 'default_qty' } });
      req = { ...req, qty: Number(defaultQty?.value ?? 1) };
    }

    const riskResult = await riskManager.check(userId, req, currentPrice, balance, 'PAPER');
    if (!riskResult.passed) {
      throw new AppError(400, `Risk check failed: ${riskResult.reason}`);
    }

    const fillPrice = req.price ?? currentPrice;
    const orderValue = req.qty * fillPrice;

    if (req.side === 'BUY' && balance < orderValue) {
      throw new AppError(400, `Insufficient paper balance. Need ₹${orderValue.toFixed(2)}, have ₹${balance.toFixed(2)}`);
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        userId,
        symbol: req.symbol,
        exchange: req.exchange,
        side: req.side,
        qty: req.qty,
        price: fillPrice,
        orderType: req.orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
        product: req.product,
        status: 'FILLED',
        mode: 'PAPER',
        strategyId: req.strategyId,
        tag: req.tag,
        filledAt: new Date(),
      },
    });

    // Deduct/credit balance
    const charges = orderValue * BROKERAGE;
    if (req.side === 'BUY') {
      await this.adjustBalance(userId, -(orderValue + charges));
      const tradeId = await this.openPosition(order.id, req, fillPrice, charges);
      log.info('Paper BUY executed', { symbol: req.symbol, qty: req.qty, price: fillPrice });
      await telegramService.notify(`📈 Paper BUY: ${req.symbol} x${req.qty} @ ₹${fillPrice}`);
      return { orderId: order.id, tradeId };
    } else {
      const { tradeId, pnl } = await this.closePosition(order.id, req, fillPrice, charges, userId);
      await this.adjustBalance(userId, orderValue - charges);
      log.info('Paper SELL executed', { symbol: req.symbol, qty: req.qty, price: fillPrice, pnl });
      await telegramService.notify(`📉 Paper SELL: ${req.symbol} x${req.qty} @ ₹${fillPrice} | P&L: ₹${pnl?.toFixed(2)}`);
      return { orderId: order.id, tradeId };
    }
  }

  // ─── Open position ───────────────────────────────────────────────────────────
  private async openPosition(
    orderId: string,
    req: PlaceOrderRequest,
    fillPrice: number,
    charges: number,
  ): Promise<string> {
    const existing = await prisma.position.findFirst({
      where: { symbol: req.symbol, mode: 'PAPER', isOpen: true },
    });

    if (existing) {
      const totalQty = existing.qty + req.qty;
      const avgPrice = (existing.avgPrice * existing.qty + fillPrice * req.qty) / totalQty;
      await prisma.position.update({
        where: { id: existing.id },
        data: { qty: totalQty, avgPrice, currentPrice: fillPrice },
      });
    } else {
      const stopLoss = req.stopLoss ?? fillPrice * (1 - 0.02);
      const target = req.target ?? fillPrice * (1 + 0.04);
      await prisma.position.create({
        data: {
          symbol: req.symbol,
          exchange: req.exchange,
          qty: req.qty,
          avgPrice: fillPrice,
          currentPrice: fillPrice,
          stopLoss,
          target,
          product: req.product,
          mode: 'PAPER',
          strategyId: req.strategyId,
        },
      });
    }

    const trade = await prisma.trade.create({
      data: {
        orderId,
        symbol: req.symbol,
        exchange: req.exchange,
        side: 'BUY',
        qty: req.qty,
        entryPrice: fillPrice,
        charges,
        mode: 'PAPER',
      },
    });

    return trade.id;
  }

  // ─── Close position ──────────────────────────────────────────────────────────
  private async closePosition(
    orderId: string,
    req: PlaceOrderRequest,
    fillPrice: number,
    charges: number,
    userId: string,
  ): Promise<{ tradeId: string; pnl: number | null }> {
    const position = await prisma.position.findFirst({
      where: { symbol: req.symbol, mode: 'PAPER', isOpen: true },
    });

    let pnl: number | null = null;

    if (position) {
      pnl = (fillPrice - position.avgPrice) * req.qty - charges;
      const remaining = position.qty - req.qty;

      if (remaining <= 0) {
        await prisma.position.update({
          where: { id: position.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            currentPrice: fillPrice,
            realizedPnl: position.realizedPnl + (pnl ?? 0),
          },
        });
      } else {
        await prisma.position.update({
          where: { id: position.id },
          data: { qty: remaining, currentPrice: fillPrice },
        });
      }

      // Update strategy stats
      if (position.strategyId) {
        await prisma.strategy.update({
          where: { id: position.strategyId },
          data: {
            totalTrades: { increment: 1 },
            wins: pnl > 0 ? { increment: 1 } : undefined,
            losses: pnl <= 0 ? { increment: 1 } : undefined,
            totalPnl: { increment: pnl },
          },
        });
      }
    }

    const trade = await prisma.trade.create({
      data: {
        orderId,
        symbol: req.symbol,
        exchange: req.exchange,
        side: 'SELL',
        qty: req.qty,
        entryPrice: position?.avgPrice ?? fillPrice,
        exitPrice: fillPrice,
        pnl,
        charges,
        mode: 'PAPER',
        closedAt: new Date(),
      },
    });

    return { tradeId: trade.id, pnl };
  }

  // ─── Mark-to-market update ───────────────────────────────────────────────────
  async updatePositionPrices(quotes: Record<string, number>): Promise<void> {
    const openPositions = await prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } });

    for (const pos of openPositions) {
      const ltp = quotes[pos.symbol];
      if (!ltp) continue;

      const unrealizedPnl = (ltp - pos.avgPrice) * pos.qty;
      await prisma.position.update({
        where: { id: pos.id },
        data: { currentPrice: ltp, unrealizedPnl },
      });

      // Stop-loss trigger
      if (pos.stopLoss && ltp <= pos.stopLoss && pos.strategyId) {
        log.warn('Paper stop-loss triggered', { symbol: pos.symbol, ltp, stopLoss: pos.stopLoss });
        await telegramService.notify(`⛔ Stop-loss triggered: ${pos.symbol} @ ₹${ltp}`);
        // SL order would be placed here via the trading service
      }

      // Target hit
      if (pos.target && ltp >= pos.target) {
        log.info('Paper target reached', { symbol: pos.symbol, ltp, target: pos.target });
        await telegramService.notify(`🎯 Target reached: ${pos.symbol} @ ₹${ltp}`);
      }
    }
  }

  // ─── Daily summary ───────────────────────────────────────────────────────────
  async getDailyPnL(userId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const trades = await prisma.trade.findMany({
      where: { order: { userId }, mode: 'PAPER', createdAt: { gte: todayStart } },
      select: { pnl: true },
    });
    return trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  }

  async getSummary(userId: string) {
    const [balance, positions, dailyPnl] = await Promise.all([
      this.getBalance(userId),
      prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } }),
      this.getDailyPnL(userId),
    ]);
    const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    return { balance, unrealizedPnl, dailyPnl, openPositions: positions.length };
  }
}

export const paperEngine = new PaperTradingEngine();
