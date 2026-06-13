import { prisma } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { riskManager } from '../risk/risk-manager';
import { telegramService } from '../notifications/telegram.service';
import { AppError } from '../../middleware/errorHandler';
import { PlaceOrderRequest, UpstoxGttRule } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'LiveEngine' });
const POLL_INTERVAL_MS = 5_000;
const BROKERAGE = 0.0003;

interface UpstoxPosition {
  instrument_token: string;
  trading_symbol: string;
  exchange: string;
  product: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
}

interface UpstoxOrderDetail {
  status: string;
  average_price?: number;
  filled_quantity?: number;
  exchange?: string;
  transaction_type?: string;
}

export class LiveTradingEngine {
  // ─── Place order ─────────────────────────────────────────────────────────────
  async placeOrder(
    userId: string,
    req: PlaceOrderRequest,
    currentPrice: number,
  ): Promise<{ orderId: string }> {
    if (!req.qty || req.qty < 1) {
      const defaultQty = await prisma.setting.findUnique({ where: { key: 'default_qty' } });
      req = { ...req, qty: Number(defaultQty?.value ?? 1) };
    }

    // Fetch live equity for risk sizing
    let equity = 1_000_000;
    try {
      const funds = await upstoxClient.getFunds() as { equity?: { available_margin?: number } };
      equity = funds?.equity?.available_margin ?? equity;
    } catch {
      log.warn('Could not fetch live funds for risk check');
    }

    const riskResult = await riskManager.check(userId, req, currentPrice, equity, 'LIVE');
    if (!riskResult.passed) {
      throw new AppError(400, `Risk check failed: ${riskResult.reason}`);
    }

    // Place on Upstox
    const upstoxResp = await upstoxClient.placeOrder({
      instrument_token: req.instrumentToken,
      order_type: req.orderType.replace('_', '-') as 'MARKET' | 'LIMIT' | 'SL' | 'SL-M',
      transaction_type: req.side,
      quantity: req.qty,
      price: req.price ?? 0,
      trigger_price: req.triggerPrice,
      validity: 'DAY',
      product: req.product,
      tag: req.tag,
    });

    // Persist in DB
    const order = await prisma.order.create({
      data: {
        userId,
        brokerOrderId: upstoxResp.order_id,
        symbol: req.symbol,
        exchange: req.exchange,
        side: req.side,
        qty: req.qty,
        price: req.price,
        orderType: req.orderType as 'MARKET' | 'LIMIT' | 'SL' | 'SL_M',
        product: req.product,
        status: 'OPEN',
        mode: 'LIVE',
        strategyId: req.strategyId,
        tag: req.tag,
      },
    });

    log.info('Live order placed', { brokerOrderId: upstoxResp.order_id, symbol: req.symbol });
    await telegramService.notify(`📤 Live ${req.side}: ${req.symbol} x${req.qty} @ ₹${req.price ?? currentPrice}`);

    // Attach broker-side stop-loss/target protection so the position remains
    // covered even if this process is down or the WS feed disconnects.
    await this.placeBracketProtection(order.id, req);

    // Start polling for fill
    this.pollOrderStatus(order.id, upstoxResp.order_id, userId);

    return { orderId: order.id };
  }

  // ─── Bracket protection (GTT OCO: target + stop-loss) ─────────────────────────
  private async placeBracketProtection(dbOrderId: string, req: PlaceOrderRequest): Promise<void> {
    if (!req.stopLoss && !req.target) return;

    // The GTT exit order closes the position, so it transacts on the
    // opposite side of the entry.
    const exitSide: 'BUY' | 'SELL' = req.side === 'BUY' ? 'SELL' : 'BUY';

    const rules: UpstoxGttRule[] = [];
    if (req.target) {
      rules.push({
        strategy: 'TARGET',
        trigger_type: req.side === 'BUY' ? 'ABOVE' : 'BELOW',
        trigger_price: req.target,
      });
    }
    if (req.stopLoss) {
      rules.push({
        strategy: 'STOPLOSS',
        trigger_type: req.side === 'BUY' ? 'BELOW' : 'ABOVE',
        trigger_price: req.stopLoss,
      });
    }

    try {
      const gtt = await upstoxClient.placeGttOrder({
        type: rules.length === 2 ? 'OCO' : 'SINGLE',
        quantity: req.qty ?? 1,
        product: req.product,
        instrument_token: req.instrumentToken,
        transaction_type: exitSide,
        rules,
      });

      await prisma.order.update({
        where: { id: dbOrderId },
        data: { gttOrderIds: gtt.gtt_order_ids },
      });

      log.info('GTT bracket order placed', { dbOrderId, gttOrderIds: gtt.gtt_order_ids, rules });
    } catch (err) {
      log.error('Failed to place GTT bracket order — position is unprotected', { dbOrderId, err });
      await telegramService.alert(
        '⚠️ Unprotected LIVE position',
        `Could not place stop-loss/target GTT for order ${dbOrderId} (${req.symbol}). ` +
        `Reason: ${(err as Error).message}. Manual SL/target monitoring required.`,
      );
    }
  }

  // ─── Poll order fill ─────────────────────────────────────────────────────────
  private pollOrderStatus(dbOrderId: string, brokerOrderId: string, userId: string): void {
    const poll = async () => {
      try {
        const detail = await upstoxClient.getOrderDetails(brokerOrderId) as UpstoxOrderDetail;
        const rawStatus = (detail.status ?? '').toLowerCase();

        const statusMap: Record<string, string> = {
          complete: 'FILLED',
          cancelled: 'CANCELLED',
          rejected: 'REJECTED',
          'trigger pending': 'TRIGGER_PENDING',
          open: 'OPEN',
        };
        const newStatus = statusMap[rawStatus] ?? 'OPEN';

        await prisma.order.update({
          where: { id: dbOrderId },
          data: {
            status: newStatus as 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'TRIGGER_PENDING',
            filledAt: newStatus === 'FILLED' ? new Date() : undefined,
          },
        });

        if (newStatus === 'FILLED') {
          const fillPrice = detail.average_price ?? 0;
          const fillQty = detail.filled_quantity ?? 0;
          const value = fillQty * fillPrice;
          const charges = value * BROKERAGE;

          await prisma.trade.create({
            data: {
              orderId: dbOrderId,
              symbol: '',
              exchange: detail.exchange ?? 'NSE',
              side: (detail.transaction_type ?? 'BUY') as 'BUY' | 'SELL',
              qty: fillQty,
              entryPrice: fillPrice,
              charges,
              mode: 'LIVE',
            },
          });

          log.info('Live order filled', { brokerOrderId, fillPrice, fillQty });
          await telegramService.notify(`✅ Live order filled: ${fillQty} @ ₹${fillPrice}`);
          await this.syncPositions();
          return; // Stop polling
        }

        if (['CANCELLED', 'REJECTED'].includes(newStatus)) {
          log.warn('Live order terminal state', { brokerOrderId, status: newStatus });
          // Entry never filled — cancel any GTT bracket placed against it so
          // there's no dangling exit order for a position that doesn't exist.
          await this.cancelBracketProtection(dbOrderId);
          return; // Stop polling
        }

        // Continue polling
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        log.error('Order poll error', { brokerOrderId, err });
        setTimeout(poll, POLL_INTERVAL_MS * 2);
      }
    };

    setTimeout(poll, POLL_INTERVAL_MS);
  }

  // ─── Cancel order ─────────────────────────────────────────────────────────────
  async cancelOrder(dbOrderId: string): Promise<void> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: dbOrderId } });
    if (!order.brokerOrderId) throw new AppError(400, 'No broker order ID found');
    await upstoxClient.cancelOrder(order.brokerOrderId);
    await prisma.order.update({ where: { id: dbOrderId }, data: { status: 'CANCELLED' } });
    await this.cancelBracketProtection(dbOrderId);
  }

  private async cancelBracketProtection(dbOrderId: string): Promise<void> {
    const order = await prisma.order.findUnique({ where: { id: dbOrderId } });
    const gttOrderIds = (order?.gttOrderIds as string[] | null) ?? [];
    if (!gttOrderIds.length) return;

    for (const gttId of gttOrderIds) {
      try {
        await upstoxClient.cancelGttOrder(gttId);
      } catch (err) {
        log.error('Failed to cancel GTT order', { dbOrderId, gttId, err });
      }
    }
    await prisma.order.update({ where: { id: dbOrderId }, data: { gttOrderIds: [] } });
  }

  // ─── Sync live positions ──────────────────────────────────────────────────────
  async syncPositions(): Promise<void> {
    try {
      const livePositions = await upstoxClient.getPositions() as UpstoxPosition[];

      for (const lp of livePositions) {
        if (lp.quantity === 0) {
          await prisma.position.updateMany({
            where: { symbol: lp.instrument_token, mode: 'LIVE', isOpen: true },
            data: { isOpen: false, closedAt: new Date(), currentPrice: lp.last_price },
          });
          continue;
        }

        await prisma.position.upsert({
          where: { symbol_mode_open: { symbol: lp.instrument_token, mode: 'LIVE', isOpen: true } },
          update: { qty: lp.quantity, currentPrice: lp.last_price, unrealizedPnl: lp.pnl },
          create: {
            symbol: lp.instrument_token,
            exchange: lp.exchange,
            qty: lp.quantity,
            avgPrice: lp.average_price,
            currentPrice: lp.last_price,
            unrealizedPnl: lp.pnl,
            product: lp.product,
            mode: 'LIVE',
          },
        });
      }
    } catch (err) {
      log.error('Failed to sync live positions', { err });
    }
  }

  async getDailyPnL(userId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const trades = await prisma.trade.findMany({
      where: { order: { userId }, mode: 'LIVE', createdAt: { gte: todayStart } },
      select: { pnl: true },
    });
    return trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  }
}

export const liveEngine = new LiveTradingEngine();
