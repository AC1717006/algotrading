import { prisma } from '../../database/client';
import { riskManager } from '../risk/risk-manager';
import { telegramService } from '../notifications/telegram.service';
import { AppError } from '../../middleware/errorHandler';
import { PlaceOrderRequest } from '../../types';
import { logger } from '../../utils/logger';
import { instrumentMappingService } from '../market-data/instrument-mapping';

const log = logger.child({ category: 'PaperEngine' });
const BROKERAGE = 0.0003; // 0.03% per leg

// Helper to read the `side` field from a Prisma Position row
// (added via migration — cast through unknown to avoid TS strict-mode errors)
function positionSide(pos: { side?: unknown }): 'BUY' | 'SELL' {
  return (pos.side as 'BUY' | 'SELL') ?? 'BUY';
}

type AutoExitPosition = {
  id: string;
  symbol: string;
  exchange: string;
  qty: number;
  avgPrice: number;
  product: string;
  strategyId: string | null;
  side?: unknown;
};

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
    log.info('[ORDER_CREATED] Paper order request', { symbol: req.symbol, side: req.side, qty: req.qty, price: currentPrice });

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
    const qty = req.qty ?? 1;
    const orderValue = qty * fillPrice;
    const charges = orderValue * BROKERAGE;

    // Check if an opposite-direction position already exists (close scenario)
    const existingPos = await prisma.position.findFirst({
      where: { symbol: req.symbol, mode: 'PAPER', isOpen: true },
    });
    const existingSide = existingPos ? positionSide(existingPos as { side?: unknown }) : null;

    // Determine action:
    // BUY  + no pos        → open LONG    (deduct orderValue + charges)
    // SELL + no pos        → open SHORT   (receive orderValue - charges)
    // BUY  + existing SELL → close SHORT  (deduct orderValue + charges to buy back)
    // SELL + existing BUY  → close LONG   (receive orderValue - charges)
    const isClosingLong = req.side === 'SELL' && existingSide === 'BUY';
    const isClosingShort = req.side === 'BUY' && existingSide === 'SELL';

    if (req.side === 'BUY' && !isClosingShort) {
      // Opening LONG or pyramiding into LONG — need cash
      if (balance < orderValue + charges) {
        throw new AppError(400, `Insufficient paper balance. Need ₹${(orderValue + charges).toFixed(2)}, have ₹${balance.toFixed(2)}`);
      }
    }

    const order = await prisma.order.create({
      data: {
        userId,
        symbol: req.symbol,
        exchange: req.exchange,
        side: req.side,
        qty,
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

    log.info('[ORDER_CREATED]', { orderId: order.id, symbol: req.symbol, side: req.side, qty, fillPrice });

    if (isClosingLong) {
      // SELL to close LONG — credit proceeds, deduct both-leg charges
      const { tradeId, pnl } = await this.closePosition(order.id, req, fillPrice, charges, userId, 'BUY');
      // Balance: return the sale proceeds minus sell charges (entry charges already counted in PnL)
      await this.adjustBalance(userId, orderValue - charges);
      log.info('[POSITION_CLOSE] Long closed', { symbol: req.symbol, qty, exitPrice: fillPrice, pnl });
      await telegramService.notifySell(req.symbol, qty, fillPrice, pnl ?? 0, 'PAPER');
      return { orderId: order.id, tradeId };
    }

    if (isClosingShort) {
      // BUY to cover SHORT — deduct cost of covering
      const { tradeId, pnl } = await this.closePosition(order.id, req, fillPrice, charges, userId, 'SELL');
      // Balance: deduct the buy-back cost
      await this.adjustBalance(userId, -(orderValue + charges));
      log.info('[POSITION_CLOSE] Short covered', { symbol: req.symbol, qty, coverPrice: fillPrice, pnl });
      await telegramService.notifySell(req.symbol, qty, fillPrice, pnl ?? 0, 'PAPER');
      return { orderId: order.id, tradeId };
    }

    if (req.side === 'BUY') {
      // Opening LONG
      await this.adjustBalance(userId, -(orderValue + charges));
      const tradeId = await this.openPosition(order.id, req, fillPrice, charges, 'BUY');
      log.info('[POSITION_OPEN] Long opened', { symbol: req.symbol, qty, avgPrice: fillPrice, charges });
      await telegramService.notifyBuy(req.symbol, qty, fillPrice, 'PAPER');
      return { orderId: order.id, tradeId };
    } else {
      // Opening SHORT (SELL with no existing BUY position)
      // Receive proceeds minus charges (margin accounted for via balance reduction later on cover)
      await this.adjustBalance(userId, orderValue - charges);
      const tradeId = await this.openPosition(order.id, req, fillPrice, charges, 'SELL');
      log.info('[POSITION_OPEN] Short opened', { symbol: req.symbol, qty, avgPrice: fillPrice, charges });
      await telegramService.notifyBuy(req.symbol, qty, fillPrice, 'PAPER');
      return { orderId: order.id, tradeId };
    }
  }

  // ─── Open position ───────────────────────────────────────────────────────────
  private async openPosition(
    orderId: string,
    req: PlaceOrderRequest,
    fillPrice: number,
    charges: number,
    side: 'BUY' | 'SELL',
  ): Promise<string> {
    const qty = req.qty ?? 1;
    const existing = await prisma.position.findFirst({
      where: { symbol: req.symbol, mode: 'PAPER', isOpen: true },
    });

    if (existing && positionSide(existing as { side?: unknown }) === side) {
      // Pyramid into existing same-direction position
      const totalQty = existing.qty + qty;
      const avgPrice = (existing.avgPrice * existing.qty + fillPrice * qty) / totalQty;
      await prisma.position.update({
        where: { id: existing.id },
        data: { qty: totalQty, avgPrice, currentPrice: fillPrice },
      });
      log.debug('Pyramided into existing position', { symbol: req.symbol, side, totalQty, avgPrice });
    } else {
      // New position with appropriate defaults
      // LONG: SL below entry, target above; SHORT: SL above entry, target below
      const stopLoss = side === 'BUY'
        ? (req.stopLoss ?? fillPrice * (1 - 0.02))
        : (req.stopLoss ?? fillPrice * (1 + 0.02));
      const target = side === 'BUY'
        ? (req.target ?? fillPrice * (1 + 0.04))
        : (req.target ?? fillPrice * (1 - 0.04));

      // Use a raw $executeRaw workaround to pass the new `side` field
      // that exists in DB (via migration) but not yet in Prisma generated types.
      // Once Prisma client is regenerated (npx prisma generate), this cast can be removed.
      await (prisma.position.create as unknown as (args: { data: Record<string, unknown> }) => Promise<unknown>)({
        data: {
          symbol:     req.symbol,
          exchange:   req.exchange,
          qty,
          avgPrice:   fillPrice,
          currentPrice: fillPrice,
          stopLoss,
          target,
          product:    req.product,
          mode:       'PAPER',
          strategyId: req.strategyId ?? null,
          side,       // NEW FIELD — requires migration to add to DB schema
        },
      });
      log.debug('[POSITION_OPEN] New paper position created', { symbol: req.symbol, side, qty, avgPrice: fillPrice, stopLoss, target });
    }

    const trade = await prisma.trade.create({
      data: {
        orderId,
        symbol:     req.symbol,
        exchange:   req.exchange,
        side,
        qty,
        entryPrice: fillPrice,
        charges,
        mode:       'PAPER',
      },
    });

    return trade.id;
  }

  // ─── Close position ──────────────────────────────────────────────────────────
  private async closePosition(
    orderId: string,
    req: PlaceOrderRequest,
    fillPrice: number,
    exitCharges: number,
    _userId: string,
    originalSide: 'BUY' | 'SELL', // the ENTRY side of the position being closed
  ): Promise<{ tradeId: string; pnl: number | null }> {
    const position = await prisma.position.findFirst({
      where: { symbol: req.symbol, mode: 'PAPER', isOpen: true },
    });

    let pnl: number | null = null;
    const closeQty = req.qty ?? 1;

    if (position) {
      // Both legs' charges reduce PnL
      const entryCharges = position.avgPrice * closeQty * BROKERAGE;
      const totalCharges = exitCharges + entryCharges;

      if (originalSide === 'BUY') {
        // Closing LONG: profit = exitPrice - entryPrice
        pnl = (fillPrice - position.avgPrice) * closeQty - totalCharges;
      } else {
        // Closing SHORT: profit = entryPrice - coverPrice
        pnl = (position.avgPrice - fillPrice) * closeQty - totalCharges;
      }

      const remaining = position.qty - closeQty;

      if (remaining <= 0) {
        // DELETE the position record — closed positions live in the Trade table.
        // Using delete instead of isOpen=false prevents the unique constraint
        // from blocking a second trade on the same symbol.
        await prisma.position.delete({ where: { id: position.id } });
        log.debug('[POSITION_CLOSE] Paper position deleted (fully closed)', { symbol: req.symbol, pnl, side: originalSide });
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
            wins:   (pnl ?? 0) > 0  ? { increment: 1 } : undefined,
            losses: (pnl ?? 0) <= 0 ? { increment: 1 } : undefined,
            totalPnl: { increment: pnl ?? 0 },
          },
        });
      }
    }

    // Exit trade record — side is opposite to the entry
    const exitSide: 'BUY' | 'SELL' = originalSide === 'BUY' ? 'SELL' : 'BUY';
    const trade = await prisma.trade.create({
      data: {
        orderId,
        symbol:     req.symbol,
        exchange:   req.exchange,
        side:       exitSide,
        qty:        closeQty,
        entryPrice: position?.avgPrice ?? fillPrice,
        exitPrice:  fillPrice,
        pnl,
        charges:    exitCharges,
        stopLoss:   position?.stopLoss ?? null,
        target:     position?.target ?? null,
        mode:       'PAPER',
        closedAt:   new Date(),
      },
    } as Parameters<typeof prisma.trade.create>[0]);

    return { tradeId: trade.id, pnl };
  }

  // ─── Auto-exit: SL / Target / EOD squareoff ──────────────────────────────────
  // Called internally from updatePositionPrices and forceSquareoff.
  // Creates the exit order + trade, deletes the position, adjusts balance.
  async autoExit(
    position: AutoExitPosition,
    exitPrice: number,
    userId: string,
    reason: 'SL_HIT' | 'TARGET_HIT' | 'EOD_SQUAREOFF',
  ): Promise<void> {
    const side = positionSide(position);
    log.info(`[${reason}] Auto-exit triggered`, { symbol: position.symbol, exitPrice, userId, side });

    const exitCharges  = position.qty * exitPrice * BROKERAGE;
    const entryCharges = position.avgPrice * position.qty * BROKERAGE;
    const totalCharges = exitCharges + entryCharges;

    // Direction-aware PnL — both legs' charges included
    const pnl = side === 'BUY'
      ? (exitPrice - position.avgPrice) * position.qty - totalCharges
      : (position.avgPrice - exitPrice) * position.qty - totalCharges;

    // For LONG auto-exit we SELL; for SHORT auto-exit we BUY back
    const exitOrderSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

    const order = await prisma.order.create({
      data: {
        userId,
        symbol:     position.symbol,
        exchange:   position.exchange,
        side:       exitOrderSide,
        qty:        position.qty,
        price:      exitPrice,
        orderType:  'MARKET',
        product:    position.product,
        status:     'FILLED',
        mode:       'PAPER',
        strategyId: position.strategyId,
        tag:        reason,
        filledAt:   new Date(),
      },
    });

    await prisma.trade.create({
      data: {
        orderId:    order.id,
        symbol:     position.symbol,
        exchange:   position.exchange,
        side:       exitOrderSide,
        qty:        position.qty,
        entryPrice: position.avgPrice,
        exitPrice,
        pnl,
        charges:    exitCharges,
        stopLoss:   (position as { stopLoss?: number | null }).stopLoss ?? null,
        target:     (position as { target?: number | null }).target ?? null,
        mode:       'PAPER',
        closedAt:   new Date(),
      },
    } as Parameters<typeof prisma.trade.create>[0]);

    await prisma.position.delete({ where: { id: position.id } });

    if (position.strategyId) {
      await prisma.strategy.update({
        where: { id: position.strategyId },
        data: {
          totalTrades: { increment: 1 },
          wins:   pnl > 0  ? { increment: 1 } : undefined,
          losses: pnl <= 0 ? { increment: 1 } : undefined,
          totalPnl: { increment: pnl },
        },
      });
    }

    // Balance adjustment:
    //   LONG exit: receive proceeds - exit charges
    //   SHORT cover: pay cover cost + exit charges
    if (side === 'BUY') {
      await this.adjustBalance(userId, position.qty * exitPrice - exitCharges);
    } else {
      await this.adjustBalance(userId, -(position.qty * exitPrice + exitCharges));
    }

    if (reason === 'SL_HIT') {
      await telegramService.notifySlHit(position.symbol, exitPrice, pnl);
    } else if (reason === 'TARGET_HIT') {
      await telegramService.notifyTargetHit(position.symbol, exitPrice, pnl);
    } else {
      await telegramService.notifyForceExit(position.symbol, reason);
    }

    log.info(`[${reason}] Auto-exit complete`, { symbol: position.symbol, exitPrice, pnl, side });
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
  // Returns the new total unrealizedPnl so callers (WebSocket) can broadcast it.
  async updatePositionPrices(quotes: Record<string, number>): Promise<{ unrealizedPnl: number }> {
    const quoteCount = Object.keys(quotes).length;
    if (quoteCount === 0) return { unrealizedPnl: 0 };

    const openPositions = await prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } });
    if (openPositions.length === 0) return { unrealizedPnl: 0 };

    log.debug('[MTM_TICK]', { quoteCount, positions: openPositions.length });
    let totalUnrealizedPnl = 0;

    for (const pos of openPositions) {
      // pos.symbol may be stored in any format ("RELIANCE", "NSE_EQ:RELIANCE", instrument key).
      // quotes is always keyed by instrument key ("NSE_EQ|INE002A01018") from the Upstox feed.
      // Normalize so both sides use the same format.
      const instrumentKey = instrumentMappingService.getInstrumentKey(pos.symbol);
      const ltp = quotes[instrumentKey] ?? quotes[pos.symbol];
      if (!ltp) {
        log.debug('[MTM_SKIP] No quote for position', { symbol: pos.symbol, instrumentKey });
        continue;
      }

      const side = positionSide(pos as { side?: unknown });

      // Check SL/target BEFORE writing MTM so we don't update a position
      // we're about to delete. Direction-aware logic for LONG vs SHORT.
      const slHit = pos.stopLoss !== null && (
        side === 'BUY'
          ? ltp <= pos.stopLoss   // LONG SL: price falls to or below SL
          : ltp >= pos.stopLoss   // SHORT SL: price rises to or above SL
      );

      const targetHit = pos.target !== null && (
        side === 'BUY'
          ? ltp >= pos.target     // LONG target: price rises to or above target
          : ltp <= pos.target     // SHORT target: price falls to or below target
      );

      if (slHit) {
        log.warn('[SL_HIT]', { symbol: pos.symbol, ltp, stopLoss: pos.stopLoss, side });
        const userId = await this.getPositionUserId(pos.strategyId);
        if (userId) {
          await this.autoExit(pos as AutoExitPosition, ltp, userId, 'SL_HIT');
        } else {
          log.error('SL triggered but no userId found — cannot auto-exit', { symbol: pos.symbol });
        }
        continue;
      }

      if (targetHit) {
        log.info('[TARGET_HIT]', { symbol: pos.symbol, ltp, target: pos.target, side });
        const userId = await this.getPositionUserId(pos.strategyId);
        if (userId) {
          await this.autoExit(pos as AutoExitPosition, ltp, userId, 'TARGET_HIT');
        } else {
          log.error('Target hit but no userId found — cannot auto-exit', { symbol: pos.symbol });
        }
        continue;
      }

      // Direction-aware unrealized PnL
      const unrealizedPnl = side === 'BUY'
        ? (ltp - pos.avgPrice) * pos.qty
        : (pos.avgPrice - ltp) * pos.qty;

      await prisma.position.update({
        where: { id: pos.id },
        data: { currentPrice: ltp, unrealizedPnl },
      });
      totalUnrealizedPnl += unrealizedPnl;
    }

    return { unrealizedPnl: totalUnrealizedPnl };
  }

  // ─── Force squareoff all open paper positions (15:25 EOD) ───────────────────
  async forceSquareoff(): Promise<void> {
    log.info('[FORCED_EXIT] Force squareoff initiated — closing all open PAPER positions');
    const openPositions = await prisma.position.findMany({ where: { mode: 'PAPER', isOpen: true } });
    if (openPositions.length === 0) {
      log.info('No open paper positions to squareoff');
      return;
    }
    for (const pos of openPositions) {
      const userId = await this.getPositionUserId(pos.strategyId);
      if (!userId) {
        log.error('[FORCED_EXIT] Squareoff skipped — no userId found', { symbol: pos.symbol });
        continue;
      }
      // Use currentPrice as best available exit price
      const exitPrice = pos.currentPrice > 0 ? pos.currentPrice : pos.avgPrice;
      await this.autoExit(pos as AutoExitPosition, exitPrice, userId, 'EOD_SQUAREOFF');
    }
    log.info(`[FORCED_EXIT] Force squareoff complete — ${openPositions.length} positions closed`);
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
