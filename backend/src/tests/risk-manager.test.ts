/**
 * Tests for RiskManager
 *
 * Run with: npx jest risk-manager
 */

jest.mock('../../database/client', () => ({
  prisma: {
    setting:   { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), upsert: jest.fn() },
    order:     { count: jest.fn(), findFirst: jest.fn() },
    trade:     { findMany: jest.fn() },
    position:  { count: jest.fn() },
    systemLog: { create: jest.fn() },
    user:      { findFirst: jest.fn() },
  },
  redis: {},
}));

jest.mock('../modules/notifications/telegram.service', () => ({
  telegramService: {
    alert:  jest.fn(),
    notify: jest.fn(),
  },
}));

import { RiskManager } from '../modules/risk/risk-manager';
import { prisma } from '../../database/client';
import { PlaceOrderRequest } from '../types';

const mockPrisma = prisma as unknown as {
  setting:   { findMany: jest.Mock; update: jest.Mock; upsert: jest.Mock };
  order:     { count: jest.Mock; findFirst: jest.Mock };
  trade:     { findMany: jest.Mock };
  position:  { count: jest.Mock };
  systemLog: { create: jest.Mock };
};

const baseOrder: PlaceOrderRequest = {
  symbol:          'RELIANCE',
  exchange:        'NSE',
  instrumentToken: 'NSE_EQ|INE002A01018',
  side:            'BUY',
  qty:             10,
  orderType:       'MARKET',
  product:         'MIS',
};

const equity = 1_000_000;

function setupDefaultMocks(rm: RiskManager, overrides: Partial<{
  circuitBreaker: boolean;
  killSwitch: boolean;
  orderCount: number;
  dailyPnl: number;
  openPositions: number;
  recentOrder: object | null;
}> = {}) {
  const {
    circuitBreaker = false,
    killSwitch     = false,
    orderCount     = 0,
    dailyPnl       = 0,
    openPositions  = 0,
    recentOrder    = null,
  } = overrides;

  // Simulate loaded settings
  const settingsRows = [
    { key: 'max_daily_loss_pct',       value: '2' },
    { key: 'max_trades_per_day',        value: '20' },
    { key: 'max_position_size_pct',     value: '10' },
    { key: 'circuit_breaker_loss_pct',  value: '5' },
    { key: 'circuit_breaker_active',    value: String(circuitBreaker) },
    { key: 'max_open_positions',        value: '3' },
    { key: 'trade_cooldown_minutes',    value: '15' },
    { key: 'risk_per_trade_pct',        value: '1' },
    { key: 'kill_switch_active',        value: String(killSwitch) },
  ];
  mockPrisma.setting.findMany.mockResolvedValue(settingsRows);
  mockPrisma.order.count.mockResolvedValue(orderCount);
  mockPrisma.trade.findMany.mockResolvedValue(
    dailyPnl !== 0 ? [{ pnl: dailyPnl }] : [],
  );
  mockPrisma.position.count.mockResolvedValue(openPositions);
  mockPrisma.order.findFirst.mockResolvedValue(recentOrder);
}

describe('RiskManager', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = new RiskManager();
    jest.clearAllMocks();
  });

  it('passes all checks for a valid order', async () => {
    setupDefaultMocks(rm);
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(true);
  });

  it('blocks when circuit breaker is active', async () => {
    setupDefaultMocks(rm, { circuitBreaker: true });
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Circuit breaker/);
  });

  it('blocks when kill switch is active', async () => {
    setupDefaultMocks(rm, { killSwitch: true });
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Kill switch/);
  });

  it('blocks when daily trade limit is reached', async () => {
    setupDefaultMocks(rm, { orderCount: 20 }); // limit is 20
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Daily trade limit/);
  });

  it('blocks when daily loss limit is exceeded', async () => {
    // 2% of 1M = 20,000 loss limit; daily PnL = -21,000
    setupDefaultMocks(rm, { dailyPnl: -21_000 });
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Daily loss limit/);
  });

  it('blocks when max open positions reached', async () => {
    setupDefaultMocks(rm, { openPositions: 3 }); // limit is 3
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Max open positions/);
  });

  it('blocks during cooldown period for same symbol', async () => {
    const recentOrder = {
      id: 'order-recent',
      filledAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago (within 15 min cooldown)
    };
    setupDefaultMocks(rm, { recentOrder });
    const result = await rm.check('user-1', baseOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Trade cooldown/);
  });

  it('blocks when risk per trade % is exceeded', async () => {
    setupDefaultMocks(rm);
    // Risk = qty * |price - stopLoss| = 10 * |100 - 90| = 100
    // Max risk = 1% of 1M = 10,000 — so 100 should PASS (test large risk instead)
    // Adjust: qty=1000, |100-90|=10 → risk=10,000 = maxRisk exactly — passes
    // qty=1001 → risk=10,010 > 10,000 → fails
    const highRiskOrder: PlaceOrderRequest = {
      ...baseOrder,
      qty:      1001,
      stopLoss: 90, // |100 - 90| = 10 per share; 1001 * 10 = 10,010 > 10,000
    };
    const result = await rm.check('user-1', highRiskOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Risk per trade/);
  });

  it('passes when risk per trade is within limits', async () => {
    setupDefaultMocks(rm);
    const safeOrder: PlaceOrderRequest = {
      ...baseOrder,
      qty:      10,
      stopLoss: 90, // 10 * 10 = 100 << 10,000
    };
    const result = await rm.check('user-1', safeOrder, 100, equity, 'PAPER');
    expect(result.passed).toBe(true);
  });
});
