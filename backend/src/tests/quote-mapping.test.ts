/**
 * Tests for quote key normalization in updatePositionPrices.
 *
 * Root cause: pos.symbol may be stored as a bare trading symbol ("RELIANCE"),
 * canonical symbol ("NSE_EQ:RELIANCE"), or instrument key ("NSE_EQ|INE002A01018"),
 * while the Upstox feed keys quotes by instrument key only. Without normalization,
 * every position lookup silently returns undefined and MTM never updates.
 */

jest.mock('../database/client', () => ({
  prisma: {
    position: {
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    order: { create: jest.fn(), findFirst: jest.fn() },
    trade: { create: jest.fn() },
    strategy: { update: jest.fn() },
    setting: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findFirst: jest.fn() },
  },
  redis: { set: jest.fn(), get: jest.fn(), ping: jest.fn() },
}));

jest.mock('../modules/risk/risk-manager', () => ({
  riskManager: { check: jest.fn().mockResolvedValue({ passed: true }) },
}));

jest.mock('../modules/notifications/telegram.service', () => ({
  telegramService: {
    notify: jest.fn(),
    notifySlHit: jest.fn(),
    notifyTargetHit: jest.fn(),
    notifyForceExit: jest.fn(),
    notifyBuy: jest.fn(),
    notifySell: jest.fn(),
  },
}));

// Mock the instrument mapping service
jest.mock('../modules/market-data/instrument-mapping', () => ({
  instrumentMappingService: {
    getInstrumentKey: jest.fn((input: string) => {
      const map: Record<string, string> = {
        RELIANCE: 'NSE_EQ|INE002A01018',
        'NSE_EQ:RELIANCE': 'NSE_EQ|INE002A01018',
        'INE002A01018': 'NSE_EQ|INE002A01018',
        'NSE_EQ|INE002A01018': 'NSE_EQ|INE002A01018',
        INFY: 'NSE_EQ|INE009A01021',
        'NSE_EQ:INFY': 'NSE_EQ|INE009A01021',
      };
      return map[input] ?? input;
    }),
  },
}));

import { prisma } from '../database/client';

// Re-import AFTER mocks are set up
let paperEngine: import('../modules/trading/paper-engine').PaperTradingEngine;
beforeAll(async () => {
  const mod = await import('../modules/trading/paper-engine');
  paperEngine = mod.paperEngine;
});

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function makePosition(overrides: Partial<{
  id: string; symbol: string; exchange: string; qty: number; avgPrice: number;
  currentPrice: number; unrealizedPnl: number; stopLoss: number | null;
  target: number | null; product: string; mode: string; isOpen: boolean;
  strategyId: string | null; side: unknown;
}> = {}) {
  return {
    id: 'pos-1',
    symbol: 'RELIANCE',
    exchange: 'NSE',
    qty: 10,
    avgPrice: 2500,
    currentPrice: 2500,
    unrealizedPnl: 0,
    stopLoss: 2450,
    target: 2600,
    product: 'MIS',
    mode: 'PAPER',
    isOpen: true,
    strategyId: 'strat-1',
    side: 'BUY',
    ...overrides,
  };
}

describe('updatePositionPrices — quote key normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.position.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.position.delete as jest.Mock).mockResolvedValue({});
    (mockPrisma.order.create as jest.Mock).mockResolvedValue({ id: 'ord-1' });
    (mockPrisma.order.findFirst as jest.Mock).mockResolvedValue(null); // no prior order — falls back to user.findFirst
    (mockPrisma.trade.create as jest.Mock).mockResolvedValue({ id: 'trd-1' });
    (mockPrisma.strategy.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });
  });

  it('updates position when pos.symbol is bare trading symbol and quote key is instrument key', async () => {
    // Position stores "RELIANCE", quotes keyed by "NSE_EQ|INE002A01018"
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([makePosition({ symbol: 'RELIANCE', currentPrice: 2500 })]);

    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2520 });

    expect(mockPrisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1' },
        data: expect.objectContaining({ currentPrice: 2520, unrealizedPnl: 200 }), // (2520-2500)*10
      }),
    );
  });

  it('updates position when pos.symbol is canonical symbol ("NSE_EQ:RELIANCE")', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([makePosition({ symbol: 'NSE_EQ:RELIANCE', currentPrice: 2500 })]);

    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2530 });

    expect(mockPrisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1' },
        data: expect.objectContaining({ currentPrice: 2530 }),
      }),
    );
  });

  it('updates position when pos.symbol is already an instrument key', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([makePosition({ symbol: 'NSE_EQ|INE002A01018', currentPrice: 2500 })]);

    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2510 });

    expect(mockPrisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1' },
        data: expect.objectContaining({ currentPrice: 2510 }),
      }),
    );
  });

  it('skips position when no quote exists for that symbol (different instrument)', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([makePosition({ symbol: 'RELIANCE' })]);

    // Quote only for INFY, not RELIANCE
    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE009A01021': 1800 });

    expect(mockPrisma.position.update).not.toHaveBeenCalled();
  });

  it('does nothing when quotes dict is empty', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([makePosition()]);

    await paperEngine.updatePositionPrices({});

    expect(mockPrisma.position.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.position.update).not.toHaveBeenCalled();
  });

  it('does nothing when no open positions exist', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([]);

    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2520 });

    expect(mockPrisma.position.update).not.toHaveBeenCalled();
  });

  it('triggers SL_HIT auto-exit for LONG position when ltp falls to stopLoss', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([
      makePosition({ symbol: 'RELIANCE', avgPrice: 2500, stopLoss: 2450, target: 2600, side: 'BUY' }),
    ]);

    // ltp = 2450 = stopLoss → SL hit
    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2450 });

    // autoExit should have deleted the position and created a trade
    expect(mockPrisma.position.delete).toHaveBeenCalledWith({ where: { id: 'pos-1' } });
    expect(mockPrisma.trade.create).toHaveBeenCalled();
  });

  it('triggers TARGET_HIT auto-exit for LONG position when ltp reaches target', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([
      makePosition({ symbol: 'RELIANCE', avgPrice: 2500, stopLoss: 2450, target: 2600, side: 'BUY' }),
    ]);

    // ltp = 2600 = target → Target hit
    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2600 });

    expect(mockPrisma.position.delete).toHaveBeenCalledWith({ where: { id: 'pos-1' } });
    expect(mockPrisma.trade.create).toHaveBeenCalled();
  });

  it('autoExit updates strategy totalTrades, wins, and totalPnl on target hit', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([
      makePosition({ symbol: 'RELIANCE', qty: 10, avgPrice: 2500, stopLoss: 2450, target: 2600, side: 'BUY', strategyId: 'strat-1' }),
    ]);

    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2600 });

    expect(mockPrisma.strategy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'strat-1' },
        data: expect.objectContaining({
          totalTrades: { increment: 1 },
          wins: { increment: 1 },
          totalPnl: expect.objectContaining({ increment: expect.any(Number) }),
        }),
      }),
    );
  });

  it('autoExit updates strategy losses on SL hit', async () => {
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([
      makePosition({ symbol: 'RELIANCE', qty: 10, avgPrice: 2500, stopLoss: 2450, target: 2600, side: 'BUY', strategyId: 'strat-1' }),
    ]);

    // SL hit → loss
    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2450 });

    expect(mockPrisma.strategy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'strat-1' },
        data: expect.objectContaining({
          totalTrades: { increment: 1 },
          losses: { increment: 1 },
        }),
      }),
    );
  });

  it('computes unrealizedPnl correctly for SHORT position', async () => {
    // SHORT: profit when price falls
    (mockPrisma.position.findMany as jest.Mock).mockResolvedValue([
      makePosition({ symbol: 'RELIANCE', qty: 10, avgPrice: 2500, stopLoss: 2550, target: 2400, side: 'SELL' }),
    ]);

    // Price dropped to 2480 → unrealizedPnl = (2500 - 2480) * 10 = 200
    await paperEngine.updatePositionPrices({ 'NSE_EQ|INE002A01018': 2480 });

    expect(mockPrisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentPrice: 2480, unrealizedPnl: 200 }),
      }),
    );
  });
});
