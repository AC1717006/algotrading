/**
 * Tests for ThreeCandleMomentumStrategy
 *
 * Run with: npx jest three-candle
 */
import { ThreeCandleMomentumStrategy } from '../modules/strategies/three-candle-momentum.strategy';
import { Candle } from '../types';

// Helper to create a candle at a given IST time (minutes from midnight)
function makeCandle(open: number, close: number, istMinutesFromMidnight = 600): Candle {
  // Convert IST minutes to a UTC timestamp
  // IST = UTC + 5:30 = UTC + 330 min
  const utcMs = (istMinutesFromMidnight - 330) * 60 * 1000;
  return {
    timestamp: utcMs > 0 ? utcMs : Date.now(),
    open,
    high:   Math.max(open, close) + 1,
    low:    Math.min(open, close) - 1,
    close,
    volume: 1000,
  };
}

// Candle that is clearly inside the 9:20–15:15 IST trading window
const WINDOW_TS = (9 * 60 + 25 - 330) * 60 * 1000; // 9:25 IST in UTC ms

function makeWindowCandle(open: number, close: number): Candle {
  return {
    timestamp: WINDOW_TS,
    open,
    high:   Math.max(open, close) + 1,
    low:    Math.min(open, close) - 1,
    close,
    volume: 1000,
  };
}

function buildStrategy() {
  return new ThreeCandleMomentumStrategy({
    id:         'test-id',
    name:       'Test TCM',
    type:       'THREE_CANDLE_MOMENTUM',
    symbol:     'NSE_EQ|INE123A01016',
    exchange:   'NSE',
    timeframe:  '5minute',
    parameters: {},
    riskConfig: {
      stopLossPercent:    2,
      targetPercent:      4,
      maxPositionValue:   50000,
      trailingStop:       false,
    },
    mode: 'PAPER',
  });
}

// Mock getISTMinutes to always return a time inside the window (10:00 = 600 mins)
jest.mock('../modules/strategies/three-candle-momentum.strategy', () => {
  const actual = jest.requireActual('../modules/strategies/three-candle-momentum.strategy') as typeof import('../modules/strategies/three-candle-momentum.strategy');

  class PatchedStrategy extends actual.ThreeCandleMomentumStrategy {
    analyze(candles: Candle[], currentPrice: number) {
      // Override window check: always consider it inside window unless explicitly testing it
      return super.analyze(candles, currentPrice);
    }
  }

  return { ...actual, ThreeCandleMomentumStrategy: PatchedStrategy };
});

describe('ThreeCandleMomentumStrategy', () => {
  let strategy: ThreeCandleMomentumStrategy;

  beforeEach(() => {
    strategy = buildStrategy();
    // Mock Date so IST time is 10:00 (inside window)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-19T04:30:00.000Z')); // 10:00 IST
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates BUY signal on 3 consecutive green candles', () => {
    const candles: Candle[] = [
      makeWindowCandle(100, 101),
      makeWindowCandle(101, 102),
      makeWindowCandle(102, 103),
    ];
    const signal = strategy.analyze(candles, 103.5);
    expect(signal.type).toBe('BUY');
    expect(signal.stopLoss).toBe(100); // c1.open
    expect(signal.target).toBeCloseTo(103.5 * 1.02, 2);
  });

  it('generates SELL signal on 3 consecutive red candles', () => {
    const candles: Candle[] = [
      makeWindowCandle(105, 104),
      makeWindowCandle(104, 103),
      makeWindowCandle(103, 102),
    ];
    // currentPrice must be below c1.open (105) for SELL to be valid
    const signal = strategy.analyze(candles, 101.5);
    expect(signal.type).toBe('SELL');
    expect(signal.stopLoss).toBe(105); // c1.open
    expect(signal.target).toBeCloseTo(101.5 * 0.98, 2);
  });

  it('holds when pattern is mixed (GRG)', () => {
    const candles: Candle[] = [
      makeWindowCandle(100, 101), // Green
      makeWindowCandle(101, 100), // Red
      makeWindowCandle(100, 101), // Green
    ];
    const signal = strategy.analyze(candles, 101);
    expect(signal.type).toBe('HOLD');
  });

  it('holds before trading window (9:20)', () => {
    // 9:10 IST = UTC 03:40 = 3*60+40 = 220 mins from midnight
    jest.setSystemTime(new Date('2026-06-19T03:40:00.000Z')); // 9:10 IST
    const candles: Candle[] = [
      makeWindowCandle(100, 101),
      makeWindowCandle(101, 102),
      makeWindowCandle(102, 103),
    ];
    const signal = strategy.analyze(candles, 103.5);
    expect(signal.type).toBe('HOLD');
    expect(signal.reason).toMatch(/Before trading window/);
  });

  it('holds after trading window (15:15)', () => {
    // 15:20 IST = UTC 09:50
    jest.setSystemTime(new Date('2026-06-19T09:50:00.000Z')); // 15:20 IST
    const candles: Candle[] = [
      makeWindowCandle(100, 101),
      makeWindowCandle(101, 102),
      makeWindowCandle(102, 103),
    ];
    const signal = strategy.analyze(candles, 103.5);
    expect(signal.type).toBe('HOLD');
    expect(signal.reason).toMatch(/After trading window/);
  });

  it('minimum 3 candles required — holds with 2 candles', () => {
    const candles: Candle[] = [
      makeWindowCandle(100, 101),
      makeWindowCandle(101, 102),
    ];
    const signal = strategy.analyze(candles, 102.5);
    expect(signal.type).toBe('HOLD');
    expect(signal.reason).toMatch(/Not enough candles/);
  });

  it('holds BUY signal when entry <= stopLoss (entry at or below c1.open)', () => {
    // entry price (98) below c1.open (100) — invalid BUY
    const candles: Candle[] = [
      makeWindowCandle(100, 101), // c1 open=100
      makeWindowCandle(101, 102),
      makeWindowCandle(102, 103),
    ];
    const signal = strategy.analyze(candles, 98); // currentPrice < c1.open
    expect(signal.type).toBe('HOLD');
    expect(signal.reason).toMatch(/BUY setup invalid/);
  });

  it('holds SELL signal when entry >= stopLoss (entry at or above c1.open)', () => {
    // SELL with currentPrice >= c1.open (110) — invalid SHORT
    const candles: Candle[] = [
      makeWindowCandle(110, 109), // c1 open=110
      makeWindowCandle(109, 108),
      makeWindowCandle(108, 107),
    ];
    const signal = strategy.analyze(candles, 112); // currentPrice > c1.open
    expect(signal.type).toBe('HOLD');
    expect(signal.reason).toMatch(/SELL setup invalid/);
  });

  it('uses correct candle indices — c3 is most recent, c1 is oldest', () => {
    // c1=green(100→101), c2=green(101→102), c3=green(102→103)
    // Extra older candles should not affect signal
    const candles: Candle[] = [
      makeWindowCandle(50,  49),  // old red — should be ignored
      makeWindowCandle(49,  48),  // old red — should be ignored
      makeWindowCandle(100, 101), // c1
      makeWindowCandle(101, 102), // c2
      makeWindowCandle(102, 103), // c3 (most recent)
    ];
    const signal = strategy.analyze(candles, 104);
    expect(signal.type).toBe('BUY');
    expect(signal.stopLoss).toBe(100); // c1.open (index n-3 = candles[2])
  });
});
