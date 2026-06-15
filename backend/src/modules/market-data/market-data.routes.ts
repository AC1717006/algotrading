import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate } from '../../middleware/auth';
import { marketDataService } from './market-data.service';
import { instrumentService } from './instrument.service';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /market/candles:
 *   get:
 *     tags: [Market Data]
 *     summary: Get historical OHLCV candles from Upstox
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: symbol, required: true, schema: { type: string }, description: Upstox instrument key }
 *       - { in: query, name: interval, required: true, schema: { type: string }, description: "1minute|5minute|15minute|1hour|1day" }
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 */
router.get(
  '/candles',
  authenticate,
  [
    query('symbol').notEmpty(),
    query('interval').notEmpty(),
    query('from').isDate(),
    query('to').isDate(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { symbol, interval, from, to } = req.query as Record<string, string>;
    const candles = await marketDataService.getHistoricalCandles(symbol, interval, from, to);
    res.json(<ApiResponse>{ success: true, data: candles, meta: { count: candles.length } });
  },
);

/**
 * @swagger
 * /market/history:
 *   get:
 *     tags: [Market Data]
 *     summary: Get historical candles for the last N days (chunked + cached for 1minute interval)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: symbol, required: true, schema: { type: string }, description: Upstox instrument key }
 *       - { in: query, name: interval, required: false, schema: { type: string }, description: "1minute|5minute|15minute|1hour|day (default 1minute)" }
 *       - { in: query, name: days, required: false, schema: { type: integer }, description: "Number of days of history (default 90, max 90)" }
 */
router.get(
  '/history',
  authenticate,
  [
    query('symbol').notEmpty(),
    query('interval').optional().notEmpty(),
    query('days').optional().isInt({ min: 1, max: 90 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { symbol, interval, days } = req.query as Record<string, string>;
    const history = await marketDataService.getHistory(symbol, interval ?? '1minute', days ? parseInt(days, 10) : 90);
    res.json(<ApiResponse>{ success: true, data: history });
  },
);

/**
 * @swagger
 * /market/quotes:
 *   get:
 *     tags: [Market Data]
 *     summary: Get live quotes for one or more instruments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: symbols, required: true, schema: { type: string }, description: Comma-separated instrument keys }
 */
router.get(
  '/quotes',
  [query('symbols').notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { symbols } = req.query as { symbols: string };
    const keys = symbols.split(',').map((s) => s.trim()).filter(Boolean);
    const quotes = await marketDataService.getQuotes(keys);
    res.json(<ApiResponse>{ success: true, data: quotes });
  },
);

/**
 * @swagger
 * /market/ltp:
 *   get:
 *     tags: [Market Data]
 *     summary: Get last traded price from in-memory cache (fast, no Upstox call)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/ltp', authenticate, (req: Request, res: Response): void => {
  const { symbol } = req.query as { symbol?: string };
  if (symbol) {
    res.json(<ApiResponse>{ success: true, data: { symbol, ltp: marketDataService.getLtp(symbol) } });
  } else {
    res.json(<ApiResponse>{ success: true, data: marketDataService.getAllLtps() });
  }
});

/**
 * @swagger
 * /market/instruments/search:
 *   get:
 *     tags: [Market Data]
 *     summary: Search instruments by symbol, name, instrument key or ISIN
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string }, description: Search text }
 *       - { in: query, name: limit, required: false, schema: { type: integer }, description: "Max results (default 20)" }
 *       - { in: query, name: exchanges, required: false, schema: { type: string }, description: "Comma-separated segment filter, e.g. NSE_EQ,BSE_EQ. Defaults to NSE_EQ." }
 */
router.get(
  '/instruments/search',
  authenticate,
  [query('q').notEmpty()],
  (req: Request, res: Response): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { q, limit, exchanges } = req.query as { q: string; limit?: string; exchanges?: string };
    const results = exchanges
      ? instrumentService.search(q, limit ? parseInt(limit, 10) : 20, exchanges.split(',').map((e) => e.trim()).filter(Boolean))
      : instrumentService.searchNse(q, limit ? parseInt(limit, 10) : 20);
    res.json(<ApiResponse>{ success: true, data: results });
  },
);

/**
 * @swagger
 * /market/instruments/resolve:
 *   get:
 *     tags: [Market Data]
 *     summary: Resolve an instrument key, canonical symbol (SEGMENT:SYMBOL), ISIN, or bare trading symbol
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: symbols, required: true, schema: { type: string }, description: Comma-separated identifiers to resolve }
 */
router.get(
  '/instruments/resolve',
  authenticate,
  [query('symbols').notEmpty()],
  (req: Request, res: Response): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { symbols } = req.query as { symbols: string };
    const result: Record<string, ReturnType<typeof instrumentService.resolve>> = {};
    for (const s of symbols.split(',').map((s) => s.trim()).filter(Boolean)) {
      result[s] = instrumentService.resolve(s);
    }
    res.json(<ApiResponse>{ success: true, data: result });
  },
);

/**
 * @swagger
 * /market/instruments/options:
 *   get:
 *     tags: [Market Data]
 *     summary: Get the option chain for an underlying (e.g. NIFTY, BANKNIFTY, FINNIFTY, or a stock symbol)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: underlying, required: true, schema: { type: string } }
 *       - { in: query, name: expiry, required: false, schema: { type: integer }, description: "Epoch ms; defaults to the nearest expiry" }
 */
router.get(
  '/instruments/options',
  authenticate,
  [query('underlying').notEmpty()],
  (req: Request, res: Response): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { underlying, expiry } = req.query as { underlying: string; expiry?: string };
    const chain = instrumentService.getOptionChain(underlying, expiry ? parseInt(expiry, 10) : undefined);
    res.json(<ApiResponse>{ success: true, data: chain });
  },
);

/**
 * @swagger
 * /market/instruments/futures:
 *   get:
 *     tags: [Market Data]
 *     summary: Get futures contracts for an underlying (current + next month), e.g. NIFTY, BANKNIFTY, GOLD
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: underlying, required: true, schema: { type: string } }
 */
router.get(
  '/instruments/futures',
  authenticate,
  [query('underlying').notEmpty()],
  (req: Request, res: Response): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { underlying } = req.query as { underlying: string };
    res.json(<ApiResponse>{
      success: true,
      data: {
        current: instrumentService.getCurrentFuture(underlying),
        next: instrumentService.getNextFuture(underlying),
        all: instrumentService.getFutureContracts(underlying),
      },
    });
  },
);

export default router;
