import { prisma } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { logger } from '../../utils/logger';
import { Candle } from '../../types';

const log = logger.child({ category: 'Backtest' });

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface BacktestConfig {
  strategyType: string;
  symbol: string;
  exchange: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  capital: number;
  brokerage: number; // fraction, e.g. 0.0003
  slippage: number;  // points, e.g. 1
  parameters: Record<string, unknown>;
}

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  charges: number;
  reason: string;
}

export interface BacktestResult {
  id: string;
  trades: BacktestTrade[];
  metrics: {
    totalReturn: number;
    totalReturnPct: number;
    profitFactor: number;
    expectancy: number;
    winRate: number;
    avgRR: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    calmarRatio: number;
    totalTrades: number;
    wins: number;
    losses: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    equityCurve: Array<{ date: string; equity: number }>;
    monthlyReturns: Array<{ month: string; return: number; returnPct: number }>;
  };
}

// ─── Helper: IST-aligned 5-minute aggregation ─────────────────────────────────

function aggregateTo5Min(candles: Candle[]): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    const istMs = c.timestamp + 5.5 * 3_600_000;
    const d = new Date(istMs);
    const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const bucket = Math.floor(totalMin / 5) * 5;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(c);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => ({
      timestamp: group[0]!.timestamp,
      open:      group[0]!.open,
      high:      Math.max(...group.map((c) => c.high)),
      low:       Math.min(...group.map((c) => c.low)),
      close:     group[group.length - 1]!.close,
      volume:    group.reduce((s, c) => s + c.volume, 0),
    }));
}

// ─── Metrics computation ──────────────────────────────────────────────────────

function computeMetrics(
  trades: BacktestTrade[],
  capital: number,
  equityCurve: Array<{ date: string; equity: number }>,
): BacktestResult['metrics'] {
  const wins   = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const sumWins   = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const winRate    = trades.length ? wins.length / trades.length : 0;
  const avgWin     = wins.length   ? sumWins / wins.length       : 0;
  const avgLoss    = losses.length ? sumLosses / losses.length   : 0;
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : sumWins > 0 ? Infinity : 0;
  const expectancy   = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1]!.equity : capital;
  const totalReturn    = finalEquity - capital;
  const totalReturnPct = capital > 0 ? (totalReturn / capital) * 100 : 0;

  // Max drawdown
  let peak = capital;
  let maxDrawdown = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak - pt.equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  // Annualized return (assuming 252 trading days)
  const tradingDays = equityCurve.length || 1;
  const annualReturn = totalReturnPct * (252 / tradingDays);

  // Daily returns for Sharpe
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const curr = equityCurve[i]!.equity;
    dailyReturns.push(prev > 0 ? (curr - prev) / prev : 0);
  }
  const meanReturn = dailyReturns.length
    ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    : 0;
  const variance = dailyReturns.length
    ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length
    : 0;
  const annualStdDev = Math.sqrt(variance) * Math.sqrt(252);
  const RISK_FREE_RATE = 0.06;
  const sharpeRatio = annualStdDev > 0 ? ((annualReturn / 100) - RISK_FREE_RATE) / annualStdDev : 0;
  const calmarRatio = maxDrawdown > 0 ? (totalReturn / capital) / (maxDrawdownPct / 100) : 0;

  // Monthly returns
  const monthlyMap = new Map<string, { startEquity: number; endEquity: number }>();
  for (const pt of equityCurve) {
    const month = pt.date.substring(0, 7); // YYYY-MM
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { startEquity: pt.equity, endEquity: pt.equity });
    } else {
      monthlyMap.get(month)!.endEquity = pt.equity;
    }
  }
  const monthlyReturns = Array.from(monthlyMap.entries()).map(([month, { startEquity, endEquity }]) => ({
    month,
    return:    endEquity - startEquity,
    returnPct: startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0,
  }));

  // Average RR (risk-reward): avgWin / avgLoss
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

  const pnls   = trades.map((t) => t.pnl);
  const bestTrade  = pnls.length ? Math.max(...pnls)  : 0;
  const worstTrade = pnls.length ? Math.min(...pnls) : 0;

  return {
    totalReturn,
    totalReturnPct,
    profitFactor,
    expectancy,
    winRate: winRate * 100,
    avgRR,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    calmarRatio,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    equityCurve,
    monthlyReturns,
  };
}

// ─── Three Candle Momentum backtest logic ─────────────────────────────────────

function runThreeCandleMomentum(
  candles: Candle[],
  capital: number,
  brokerage: number,
  slippage: number,
  parameters: Record<string, unknown>,
): { trades: BacktestTrade[]; equityCurve: Array<{ date: string; equity: number }> } {
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ date: string; equity: number }> = [];
  let equity = capital;
  let openTrade: {
    side: 'BUY' | 'SELL';
    entryDate: string;
    entryPrice: number;
    qty: number;
    stopLoss: number;
    target: number;
  } | null = null;

  const targetPct = (parameters['targetPct'] as number | undefined) ?? 0.02;
  const positionValuePct = (parameters['positionValuePct'] as number | undefined) ?? 0.10;

  for (let i = 3; i < candles.length; i++) {
    const c1 = candles[i - 3]!;
    const c2 = candles[i - 2]!;
    const c3 = candles[i - 1]!;
    const current = candles[i]!;
    const dateStr = new Date(current.timestamp).toISOString().substring(0, 10);

    // Check for exit if position is open
    if (openTrade) {
      const ltp = current.close;
      let exitPrice: number | null = null;
      let exitReason = '';

      if (openTrade.side === 'BUY') {
        if (ltp <= openTrade.stopLoss)  { exitPrice = openTrade.stopLoss - slippage; exitReason = 'SL_HIT'; }
        else if (ltp >= openTrade.target) { exitPrice = openTrade.target + slippage;  exitReason = 'TARGET_HIT'; }
      } else {
        if (ltp >= openTrade.stopLoss)  { exitPrice = openTrade.stopLoss + slippage; exitReason = 'SL_HIT'; }
        else if (ltp <= openTrade.target) { exitPrice = openTrade.target - slippage;  exitReason = 'TARGET_HIT'; }
      }

      if (exitPrice !== null) {
        const entryCharges = openTrade.entryPrice * openTrade.qty * brokerage;
        const exitCharges  = exitPrice * openTrade.qty * brokerage;
        const totalCharges = entryCharges + exitCharges;
        const pnl = openTrade.side === 'BUY'
          ? (exitPrice - openTrade.entryPrice) * openTrade.qty - totalCharges
          : (openTrade.entryPrice - exitPrice) * openTrade.qty - totalCharges;

        trades.push({
          entryDate:  openTrade.entryDate,
          exitDate:   dateStr,
          side:       openTrade.side,
          entryPrice: openTrade.entryPrice,
          exitPrice,
          qty:        openTrade.qty,
          pnl,
          charges:    totalCharges,
          reason:     exitReason,
        });

        equity += pnl;
        equityCurve.push({ date: dateStr, equity });
        openTrade = null;
      }
    }

    // Only enter if no open trade
    if (!openTrade) {
      const c1Green = c1.close > c1.open;
      const c2Green = c2.close > c2.open;
      const c3Green = c3.close > c3.open;
      const c1Red   = c1.close < c1.open;
      const c2Red   = c2.close < c2.open;
      const c3Red   = c3.close < c3.open;

      const entryPrice = current.open + slippage; // entry at open of current bar + slippage

      if (c1Green && c2Green && c3Green) {
        const stopLoss = c1.open - slippage;
        if (entryPrice > stopLoss) {
          const target = entryPrice * (1 + targetPct);
          const posValue = equity * positionValuePct;
          const qty = Math.max(1, Math.floor(posValue / entryPrice));
          openTrade = { side: 'BUY', entryDate: dateStr, entryPrice, qty, stopLoss, target };
        }
      } else if (c1Red && c2Red && c3Red) {
        const stopLoss = c1.open + slippage;
        if (entryPrice < stopLoss) {
          const target = entryPrice * (1 - targetPct);
          const posValue = equity * positionValuePct;
          const qty = Math.max(1, Math.floor(posValue / entryPrice));
          openTrade = { side: 'SELL', entryDate: dateStr, entryPrice, qty, stopLoss, target };
        }
      }
    }
  }

  // Force-close any open trade at end of data
  if (openTrade && candles.length > 0) {
    const lastCandle = candles[candles.length - 1]!;
    const exitPrice  = lastCandle.close;
    const dateStr    = new Date(lastCandle.timestamp).toISOString().substring(0, 10);
    const entryCharges = openTrade.entryPrice * openTrade.qty * brokerage;
    const exitCharges  = exitPrice * openTrade.qty * brokerage;
    const totalCharges = entryCharges + exitCharges;
    const pnl = openTrade.side === 'BUY'
      ? (exitPrice - openTrade.entryPrice) * openTrade.qty - totalCharges
      : (openTrade.entryPrice - exitPrice) * openTrade.qty - totalCharges;

    trades.push({
      entryDate:  openTrade.entryDate,
      exitDate:   dateStr,
      side:       openTrade.side,
      entryPrice: openTrade.entryPrice,
      exitPrice,
      qty:        openTrade.qty,
      pnl,
      charges:    totalCharges,
      reason:     'EOD_CLOSE',
    });
    equity += pnl;
    equityCurve.push({ date: dateStr, equity });
  }

  return { trades, equityCurve };
}

// ─── BacktestService ──────────────────────────────────────────────────────────

export class BacktestService {
  async run(cfg: BacktestConfig): Promise<BacktestResult> {
    log.info('Backtest started', { strategy: cfg.strategyType, symbol: cfg.symbol, from: cfg.fromDate, to: cfg.toDate });

    // Fetch historical 1-minute candles from Upstox
    let rawCandles: unknown[][];
    try {
      rawCandles = await upstoxClient.getHistoricalCandles(
        cfg.symbol,
        '1minute',
        cfg.toDate,
        cfg.fromDate,
      );
    } catch (err) {
      log.error('Failed to fetch historical candles for backtest', { err });
      throw new Error(`Failed to fetch candles: ${(err as Error).message}`);
    }

    const oneMinCandles: Candle[] = rawCandles
      .map((c) => ({
        timestamp: new Date(c[0] as string).getTime(),
        open:      c[1] as number,
        high:      c[2] as number,
        low:       c[3] as number,
        close:     c[4] as number,
        volume:    c[5] as number,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Aggregate to 5-minute candles for strategy logic
    const fiveMinCandles = aggregateTo5Min(oneMinCandles);
    log.info('Candles fetched', { oneMin: oneMinCandles.length, fiveMin: fiveMinCandles.length });

    if (fiveMinCandles.length < 10) {
      throw new Error(`Not enough candle data: got ${fiveMinCandles.length} 5-min candles`);
    }

    // Run strategy logic
    let trades: BacktestTrade[];
    let equityCurve: Array<{ date: string; equity: number }>;

    if (cfg.strategyType === 'THREE_CANDLE_MOMENTUM') {
      ({ trades, equityCurve } = runThreeCandleMomentum(
        fiveMinCandles,
        cfg.capital,
        cfg.brokerage,
        cfg.slippage,
        cfg.parameters,
      ));
    } else {
      throw new Error(`Strategy type '${cfg.strategyType}' not supported for backtesting yet`);
    }

    const metrics = computeMetrics(trades, cfg.capital, equityCurve);

    // Access prisma.backtest via dynamic access since the model was added via migration
    // and Prisma client hasn't been regenerated yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaAny = prisma as any;

    const dbRecord = await prismaAny.backtest.create({
      data: {
        strategyType: cfg.strategyType,
        symbol:       cfg.symbol,
        exchange:     cfg.exchange,
        fromDate:     new Date(cfg.fromDate),
        toDate:       new Date(cfg.toDate),
        capital:      cfg.capital,
        parameters:   cfg.parameters,
        result:       { trades },
        metrics,
      },
    }) as { id: string };

    log.info('Backtest complete', {
      id: dbRecord.id,
      totalTrades: metrics.totalTrades,
      totalReturnPct: metrics.totalReturnPct.toFixed(2),
    });

    return { id: dbRecord.id, trades, metrics };
  }

  async getResult(id: string): Promise<BacktestResult | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaAny = prisma as any;
    const row = await prismaAny.backtest.findUnique({ where: { id } }) as {
      id: string;
      result: unknown;
      metrics: unknown;
    } | null;
    if (!row) return null;
    const result = row.result as { trades: BacktestTrade[] };
    return {
      id:      row.id,
      trades:  result.trades,
      metrics: row.metrics as BacktestResult['metrics'],
    };
  }
}

export const backtestService = new BacktestService();
