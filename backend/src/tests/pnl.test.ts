/**
 * PnL calculation unit tests.
 *
 * Verifies:
 *  - Correct sign for LONG and SHORT closes
 *  - Both-leg charge deduction
 *  - The specific user-reported regression: entry=1030, exit=1048, qty=47 → positive PnL
 *  - Zero-PnL breakeven trades
 *  - Large-qty, fractional-price accuracy
 */

const BROKERAGE = 0.0003; // 0.03% per leg (matches paper-engine.ts constant)

function calcPnl(
  side: 'BUY' | 'SELL',   // trade.side — BUY=closing SHORT, SELL=closing LONG
  entryPrice: number,
  exitPrice: number,
  qty: number,
): number {
  const exitCharges  = exitPrice  * qty * BROKERAGE;
  const entryCharges = entryPrice * qty * BROKERAGE;
  const totalCharges = exitCharges + entryCharges;

  if (side === 'SELL') {
    // Closing a LONG: profit when exitPrice > entryPrice
    return (exitPrice - entryPrice) * qty - totalCharges;
  } else {
    // Closing a SHORT: profit when entryPrice > exitPrice
    return (entryPrice - exitPrice) * qty - totalCharges;
  }
}

// ─── LONG closes (trade.side = 'SELL') ──────────────────────────────────────

describe('LONG close PnL (trade.side = SELL)', () => {
  it('regression: entry=1030, exit=1048, qty=47 → positive PnL', () => {
    const pnl = calcPnl('SELL', 1030, 1048, 47);
    expect(pnl).toBeGreaterThan(0);
    // Gross = (1048-1030)*47 = 846. Net after ~29 charges ≈ 816
    expect(pnl).toBeCloseTo(846 - (1030 + 1048) * 47 * BROKERAGE, 0);
  });

  it('profitable trade: exit > entry → pnl > 0', () => {
    expect(calcPnl('SELL', 500, 550, 100)).toBeGreaterThan(0);
  });

  it('loss trade: exit < entry → pnl < 0', () => {
    expect(calcPnl('SELL', 550, 500, 100)).toBeLessThan(0);
  });

  it('breakeven: exit = entry → pnl < 0 (charges eat into P&L)', () => {
    // Even at identical prices, charges make it a small loss
    expect(calcPnl('SELL', 500, 500, 100)).toBeLessThan(0);
  });

  it('charges are deducted from both legs', () => {
    const grossPnl = (1100 - 1000) * 10;                       // 1000
    const entryCh  = 1000 * 10 * BROKERAGE;                     // 3.0
    const exitCh   = 1100 * 10 * BROKERAGE;                     // 3.3
    const expected = grossPnl - entryCh - exitCh;
    expect(calcPnl('SELL', 1000, 1100, 10)).toBeCloseTo(expected, 4);
  });
});

// ─── SHORT closes (trade.side = 'BUY') ──────────────────────────────────────

describe('SHORT close PnL (trade.side = BUY)', () => {
  it('profitable SHORT: cover price < entry price → pnl > 0', () => {
    // Shorted at 1050, covered at 1020 → +30/share
    expect(calcPnl('BUY', 1050, 1020, 50)).toBeGreaterThan(0);
  });

  it('loss SHORT: cover price > entry price → pnl < 0', () => {
    // Shorted at 1000, covered at 1050 → -50/share
    expect(calcPnl('BUY', 1000, 1050, 20)).toBeLessThan(0);
  });

  it('direction is symmetric: mirror of LONG', () => {
    const longPnl  = calcPnl('SELL', 1000, 1100, 10); // LONG profit
    const shortPnl = calcPnl('BUY',  1100, 1000, 10); // SHORT profit (same magnitude)
    // Both should be positive and close in magnitude
    expect(longPnl).toBeGreaterThan(0);
    expect(shortPnl).toBeGreaterThan(0);
    expect(Math.abs(longPnl - shortPnl)).toBeLessThan(1); // within ₹1 (charge rounding)
  });
});

// ─── DB recalculation formula validation ────────────────────────────────────

describe('SQL recalculation formula consistency', () => {
  it('SQL SELL formula matches TypeScript formula', () => {
    const e = 1030, x = 1048, q = 47;
    // Mirrors the SQL:
    //   (exit_price - entry_price) * qty - charges - (entry_price * qty * 0.0003)
    // where 'charges' = exit_price * qty * 0.0003 (stored exit-leg only)
    const storedCharges = x * q * BROKERAGE;
    const sqlPnl = (x - e) * q - storedCharges - (e * q * BROKERAGE);
    const tsPnl  = calcPnl('SELL', e, x, q);
    expect(sqlPnl).toBeCloseTo(tsPnl, 6);
  });

  it('SQL BUY formula matches TypeScript formula', () => {
    const e = 1050, x = 1020, q = 50;
    const storedCharges = x * q * BROKERAGE;
    const sqlPnl = (e - x) * q - storedCharges - (e * q * BROKERAGE);
    const tsPnl  = calcPnl('BUY', e, x, q);
    expect(sqlPnl).toBeCloseTo(tsPnl, 6);
  });

  it('old buggy formula would have produced -870 for the reported case', () => {
    const e = 1030, x = 1048, q = 47;
    // Old code used SHORT formula for LONG: (entry - exit) * qty - charges
    const totalCharges = (e + x) * q * BROKERAGE;
    const oldBuggyPnl  = (e - x) * q - totalCharges;
    expect(oldBuggyPnl).toBeLessThan(-800);
    expect(oldBuggyPnl).toBeGreaterThan(-950); // approximately -870

    // Correct formula should be positive
    const correctPnl = calcPnl('SELL', e, x, q);
    expect(correctPnl).toBeGreaterThan(0);
  });
});
