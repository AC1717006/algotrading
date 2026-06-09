import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate } from '../../middleware/auth';
import { marketDataService } from './market-data.service';
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
  authenticate,
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

export default router;
