/**
 * Tests for PaperTradingEngine
 *
 * Run with: npx jest paper-engine
 *
 * NOTE: Prisma and Redis are mocked — no real DB connections needed.
 */

// Mock database and dependencies before imports
jest.mock('../../database/client', () => ({
  prisma: {
    setting:   { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    order:     { create: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    position:  { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    trade:     { create: jest.fn(), findMany: jest.fn() },
    strategy:  { update: jest.fn() },
    user:      { findFirst: jest.fn() },
  },
  redis: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../modules/risk/risk-manager', () => ({
  riskManager: { check: jest.fn().mockResolvedValue({ passed: true }) },
}));

jest.mock('../modules/notifications/telegram.service', () => ({
  telegramService: {
    notify:          jest.fn(),
    notifyBuy:       jest.fn(),
    notifySell:      jest.fn(),
    notifySlHit:     jest.fn(),
    notifyTargetHit: jest.fn(),
    notifyForceExit: jest.fn(),
  },
}));

import { PaperTradingEngine } from '../modules/trading/paper-engine';
import { prisma } from '../../database/client';

const mockPrisma = prisma as unknown as {
  setting:  { findUnique: jest.Mock; upsert: jest.Mock; findMany: jest.Mock };
  order:    { create: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
  position: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  trade:    { create: jest.Mock; findMany: jest.Mock };
  strategy: { update: jest.Mock };
  user:     { findFirst: jest.Mock };
};

const BROKERAGE = 0.0003;

describe('PaperTradingEngine', () => {
  let engine: PaperTradingEngine;
  const userId = 'user-1';
  const balance = 1_000_000;

  beforeEach(() => {
    engine = new PaperTradingEngine();
    jest.clearAllMocks();

    // Default balance mock
    mockPrisma.setting.findUnique.mockResolvedValue({ value: String(balance) });
    mockPrisma.setting.upsert.mockResolvedValue({});
    mockPrisma.setting.findMany.mockResolvedValue([]);
    // Default: no existing position
    mockPrisma.position.findFirst.mockResolvedValue(null);
    // Mock order create
    mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
    // Mock trade create
    mockPrisma.trade.create.mockResolvedValue({ id: 'trade-1' });
    // Mock user
    mockPrisma.user.findFirst.mockResolvedValue({ id: userId });
  });

  // ─── BUY → LONG open ─────────────────────────────────────────────────────────
  it('BUY — creates LONG position and deducts balance', async () => {
    mockPrisma.position.create.mockResolvedValue({ id: 'pos-1' });

    const fillPrice = 100;
    const qty = 10;
    await engine.placeOrder(userId, {
      symbol: 'RELIANCE', exchange: 'NSE', instrumentToken: 'NSE_EQ|INE002A01018',
      side: 'BUY', qty, orderType: 'MARKET', product: 'MIS',
    }, fillPrice);

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ side: 'BUY', qty, mode: 'PAPER' }) }),
    );
    expect(mockPrisma.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ side: 'BUY', qty, avgPrice: fillPrice }) }),
    );
    // Balance should be decremented: -(orderValue + charges)
    const expectedDeduction = -(qty * fillPrice + qty * fillPrice * BROKERAGE);
    expect(mockPrisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: String(balance + expectedDeduction) },
      }),
    );
  });

  // ─── SELL to close LONG ───────────────────────────────────────────────────────
  it('SELL — closes LONG position and calculates PnL with both legs charges', async () => {
    const avgPrice   = 100;
    const exitPrice  = 110;
    const qty        = 10;

    // Existing LONG position
    mockPrisma.position.findFirst.mockResolvedValue({
      id: 'pos-1', symbol: 'RELIANCE', exchange: 'NSE',
      side: 'BUY', qty, avgPrice, strategyId: null,
    });
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.placeOrder(userId, {
      symbol: 'RELIANCE', exchange: 'NSE', instrumentToken: 'NSE_EQ|INE002A01018',
      side: 'SELL', qty, orderType: 'MARKET', product: 'MIS',
    }, exitPrice);

    // PnL = (exit - entry)*qty - (entry*qty*brokerage + exit*qty*brokerage)
    const entryCharges = avgPrice * qty * BROKERAGE;
    const exitCharges  = exitPrice * qty * BROKERAGE;
    const expectedPnl  = (exitPrice - avgPrice) * qty - entryCharges - exitCharges;

    expect(mockPrisma.trade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pnl:      expectedPnl,
          side:     'SELL',
          exitPrice,
        }),
      }),
    );
    expect(mockPrisma.position.delete).toHaveBeenCalledWith({ where: { id: 'pos-1' } });
  });

  // ─── SHORT open ───────────────────────────────────────────────────────────────
  it('SHORT SELL — opens SHORT position with side=SELL', async () => {
    mockPrisma.position.create.mockResolvedValue({ id: 'pos-short' });
    const fillPrice = 200;
    const qty = 5;

    await engine.placeOrder(userId, {
      symbol: 'INFY', exchange: 'NSE', instrumentToken: 'NSE_EQ|INE009A01021',
      side: 'SELL', qty, orderType: 'MARKET', product: 'MIS',
    }, fillPrice);

    expect(mockPrisma.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ side: 'SELL' }) }),
    );
    // Balance: + orderValue - charges
    const expectedCredit = qty * fillPrice - qty * fillPrice * BROKERAGE;
    expect(mockPrisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: String(balance + expectedCredit) } }),
    );
  });

  // ─── SHORT cover ──────────────────────────────────────────────────────────────
  it('SHORT COVER — closes SHORT with profit when price fell', async () => {
    const shortPrice = 200;
    const coverPrice = 190; // price fell → profit for SHORT
    const qty = 5;

    // Existing SHORT position
    mockPrisma.position.findFirst.mockResolvedValue({
      id: 'pos-short', symbol: 'INFY', exchange: 'NSE',
      side: 'SELL', qty, avgPrice: shortPrice, strategyId: null,
    });
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.placeOrder(userId, {
      symbol: 'INFY', exchange: 'NSE', instrumentToken: 'NSE_EQ|INE009A01021',
      side: 'BUY', qty, orderType: 'MARKET', product: 'MIS',
    }, coverPrice);

    const entryCharges = shortPrice * qty * BROKERAGE;
    const exitCharges  = coverPrice * qty * BROKERAGE;
    const expectedPnl  = (shortPrice - coverPrice) * qty - entryCharges - exitCharges;

    expect(mockPrisma.trade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pnl: expectedPnl }),
      }),
    );
    expect(expectedPnl).toBeGreaterThan(0); // should be profitable
  });

  // ─── SL auto-exit for LONG ───────────────────────────────────────────────────
  it('SL auto-exit triggers for LONG when ltp <= stopLoss', async () => {
    const avgPrice = 100;
    const stopLoss = 95;
    const ltp      = 94; // below SL

    mockPrisma.position.findMany.mockResolvedValue([{
      id: 'pos-1', symbol: 'RELIANCE', exchange: 'NSE',
      side: 'BUY', qty: 10, avgPrice, stopLoss, target: 110,
      currentPrice: 98, strategyId: null, product: 'MIS',
    }]);
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.updatePositionPrices({ RELIANCE: ltp });

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tag: 'SL_HIT', side: 'SELL' }) }),
    );
    expect(mockPrisma.position.delete).toHaveBeenCalledWith({ where: { id: 'pos-1' } });
  });

  // ─── Target auto-exit for LONG ───────────────────────────────────────────────
  it('Target auto-exit triggers for LONG when ltp >= target', async () => {
    const avgPrice = 100;
    const target   = 110;
    const ltp      = 111; // above target

    mockPrisma.position.findMany.mockResolvedValue([{
      id: 'pos-1', symbol: 'TCS', exchange: 'NSE',
      side: 'BUY', qty: 5, avgPrice, stopLoss: 95, target,
      currentPrice: 108, strategyId: null, product: 'MIS',
    }]);
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.updatePositionPrices({ TCS: ltp });

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tag: 'TARGET_HIT', side: 'SELL' }) }),
    );
  });

  // ─── SL auto-exit for SHORT ───────────────────────────────────────────────────
  it('SL auto-exit triggers for SHORT when ltp >= stopLoss', async () => {
    const avgPrice = 200;
    const stopLoss = 210;
    const ltp      = 211; // above SL for SHORT

    mockPrisma.position.findMany.mockResolvedValue([{
      id: 'pos-short', symbol: 'INFY', exchange: 'NSE',
      side: 'SELL', qty: 5, avgPrice, stopLoss, target: 185,
      currentPrice: 205, strategyId: null, product: 'MIS',
    }]);
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.updatePositionPrices({ INFY: ltp });

    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tag: 'SL_HIT', side: 'BUY' }) }),
    );
  });

  // ─── EOD squareoff ────────────────────────────────────────────────────────────
  it('EOD squareoff closes all open positions', async () => {
    mockPrisma.position.findMany.mockResolvedValue([
      {
        id: 'pos-1', symbol: 'RELIANCE', exchange: 'NSE',
        side: 'BUY', qty: 10, avgPrice: 100, stopLoss: 95, target: 110,
        currentPrice: 105, strategyId: null, product: 'MIS',
      },
      {
        id: 'pos-2', symbol: 'INFY', exchange: 'NSE',
        side: 'SELL', qty: 5, avgPrice: 200, stopLoss: 210, target: 185,
        currentPrice: 195, strategyId: null, product: 'MIS',
      },
    ]);
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.position.delete.mockResolvedValue({});

    await engine.forceSquareoff();

    // Both positions should be deleted
    expect(mockPrisma.position.delete).toHaveBeenCalledTimes(2);
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tag: 'EOD_SQUAREOFF' }) }),
    );
  });
});
