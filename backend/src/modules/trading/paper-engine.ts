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
    log.info('Paper order request', { symbol: req.symbol, side: req.side, qty: req.qty, price: currentPrice });

    const balance = await this.getBalance(userId);

    if (!req.qty || req.qty < 1) {
      const defaultQty = await prisma.setting.findUnique({ where: { key: 'default_qty' } });
      req = { ...req, qty: Number(defaultQty?.value ?? 1) };
    }

    const riskResult = await riskManager.check(userId, req, currentPrice, balance, 'PAPER');
    if (!riskResult.passed) {
      log.warn('Paper order rejected by risk manager', { symbol: req.symbol, reason: riskResult.reason });
      throw new AppError(400, `Risk check failed: ${riskResult.reason}`);
    }

    const fillPrice = req.price ?? currentPrice;
    const orderValue = req.qty * fillPrice;

    if (req.side === 'BUY' && balance < orderValue) {
      throw new AppError(400, `Insufficient paper balance. Need ₹${orderValue.toFixed(2)}, have ₹${balance.toFixed(2)}`);
    }

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

    log.info('Paper order created', { orderId: order.id, symbol: req.symbol, side: req.side, qty: req.qty, fillPrice });

    const charges = orderValue * BROKERAGE;

    if (req.side === 'BUY') {
      await this.adjustBalance(userId, -(orderValue + charges));
      const tradeId = await this.openPosition(order.id, req, fillPrice, charges);
      log.info('Paper position opened', { symbol: req.symbol, qty: req.qty, avgPrice: fillPrice, charges });
      await telegramService.notify(`📈 Paper BUY: ${req.symbol} x${req.qty} @ ₹${fillPrice}`);
      return { orderId: order.id, tradeId };
    } else {
      const { tradeId, pnl } = await this.closePosition(order.id, req, fillPrice, charges, userId);
      await this.adjustBalance(userId, orderValue - charges);
      log.info('Paper position closed', { symbol: req.symbol, qty: req.qty, exitPrice: fillPrice, pnl });
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
      // Pyramid into existing position
      const totalQty = existing.qty + req.qty;
      const avgPrice = (existing.avgPrice * existing.qty + fillPrice * req.qty) / totalQty;
      await prisma.position.update({
        where: { id: existing.id },
        data: { qty: totalQty, avgPrice, currentPrice: fillPrice },
      });
      log.debug('Pyramided into existing position', { symbol: req.symbol, totalQty, avgPrice });
    } else {
      // Caller may pass explicit SL/target from strategy; fall back to 2%/4% defaults
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
      log.debug('New paper position created', { symbol: req.symbol, qty: req.qty, avgPrice: fillPrice, stopLoss, target });
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
        // DELETE the position record — closed positions live in the Trade table.
        // Using delete instead of isOpen=false prevents the @@unique constraint
        // from blocking a second trade on the same symbol.
        await prisma.position.delete({ where: { id: position.id } });
        log.debug('Paper position deleted (fully closed)', { symbol: req.symbol, pnl });
      } else {
        await prisma.position.update({
          where: { id: position.id },
          data: { qty: remaining, currentPrice: fillPrice },
        });
      }

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

    void userId; // balance adjustment is done in placeOrder after this returns

    return { tradeId: trade.id, pnl };
  }

  // ─── Auto-exit: SL / Target / EOD squareoff ──────────────────────────────────
  // Called internally from updatePositionPrices and forceSquareoff.
  // Creates the exit order + trade, deletes the position, credits balance.
  async autoExit(
    position: { id: string; symbol: string; exchange: string; qty: number; avgPrice: number; product: string; strategyId: string | null },
    exitPrice: number,
    userId: string,
    reason: 'SL_HIT' | 'TARGET_HIT' | 'EOD_SQUAREOFF',
  ): Promise<void> {
    log.info(`Auto-exit triggered: ${reason}`, { symbol: position.symbol, exitPrice, userId });

    const charges = position.qty * exitPrice * BROKERAGE;
    const pnl = (exitPrice - position.avgPrice) * position.qty - charges;

    const order = await prisma.order.create({
      data: {
        userId,
        symbol: position.symbol,
        exchange: position.exchange,
        side: 'SELL',
        qty: position.qty,
        price: exitPrice,
        orderType: 'MARKET',
        product: position.product,
        status: 'FILLED',
        mode: 'PAPER',
        strategyId: position.strategyId,
        tag: reason,
        filledAt: new Date(),
      },
    });

    await prisma.trade.create({
      data: {
        orderId: order.id,
        symbol: position.symbol,
        exchange: position.exchange,
        side: 'SELL',
        qty: position.qty,
        entryPrice: position.avgPrice,
        exitPrice,
        pnl,
        charges,
        mode: 'PAPER',
        closedAt: new Date(),
      },
    });

    await prisma.position.delete({ where: { id: position.id } });

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

    await this.adjustBalance(userId, position.qty * exitPrice - charges);

    const emoji = reason === 'SL_HIT' ? '⛔' : reason === 'TARGET_HIT' ? '🎯' : '🔔';
    log.info(`Auto-exit complete`, { reason, symbol: position.symbol, exitPrice, pnl });
    await telegramService.notify(
      `${emoji} ${reason}: ${position.symbol} x${position.qty} @ ₹${exitPrice.toFixed(2)} | P&L: ₹${pnl.toFixed(2)}`,
    );
  }

  // ─── Resolve userId for a position (for auto-exit) ───────────────────────────
  private async getPositionUserId(strategyId: string | null): Promise<string | null> {
    if (strategyId) {
      const order = await prisma.order.findFirst({
        where: { strategyId, mode: 'PAPER', status: 'FILLED' },
        orderBy: { filledAt: 'desc' },
      });
      if (order) return order.userId;
    }
    const user = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'TRADER'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return user?.id ?? null;
  }

  // ─── Mark-to-market update + SL/Target enforcement ───────────────────────────
  async updatePositionPrices(quotes: Record<string, number>): Promise<void> {
    const openPositions = await prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } });

    for (const pos of openPositions) {
      const ltp = quotes[pos.symbol];
      if (!ltp) continue;

      // Check SL/target BEFORE writing MTM so we don't update a position
      // we're about to delete.
      if (pos.stopLoss && ltp <= pos.stopLoss) {
        log.warn('SL Hit', { symbol: pos.symbol, ltp, stopLoss: pos.stopLoss });
        const userId = await this.getPositionUserId(pos.strategyId);
        if (userId) {
          await this.autoExit(pos, ltp, userId, 'SL_HIT');
        } else {
          log.error('SL triggered but no userId found — cannot auto-exit', { symbol: pos.symbol });
        }
        continue;
      }

      if (pos.target && ltp >= pos.target) {
        log.info('Target Hit', { symbol: pos.symbol, ltp, target: pos.target });
        const userId = await this.getPositionUserId(pos.strategyId);
        if (userId) {
          await this.autoExit(pos, ltp, userId, 'TARGET_HIT');
        } else {
          log.error('Target hit but no userId found — cannot auto-exit', { symbol: pos.symbol });
        }
        continue;
      }

      const unrealizedPnl = (ltp - pos.avgPrice) * pos.qty;
      await prisma.position.update({
        where: { id: pos.id },
        data: { currentPrice: ltp, unrealizedPnl },
      });
    }
  }

  // ─── Force squareoff all open paper positions (15:25 EOD) ───────────────────
  async forceSquareoff(): Promise<void> {
    log.info('Force squareoff initiated — closing all open PAPER positions');
    const openPositions = await prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } });
    if (openPositions.length === 0) {
      log.info('No open paper positions to squareoff');
      return;
    }
    for (const pos of openPositions) {
      const userId = await this.getPositionUserId(pos.strategyId);
      if (!userId) {
        log.error('Squareoff skipped — no userId found', { symbol: pos.symbol });
        continue;
      }
      // Use currentPrice as best available exit price
      const exitPrice = pos.currentPrice > 0 ? pos.currentPrice : pos.avgPrice;
      await this.autoExit(pos, exitPrice, userId, 'EOD_SQUAREOFF');
    }
    log.info(`Force squareoff complete — ${openPositions.length} positions closed`);
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
