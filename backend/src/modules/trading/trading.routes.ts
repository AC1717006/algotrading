import { Router, Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { authenticate, authorize } from '../../middleware/auth';
import { orderLimiter } from '../../middleware/rateLimiter';
import { auditLog } from '../../middleware/auditLog';
import { tradingService } from './trading.service';
import { riskManager } from '../risk/risk-manager';
import { AuthRequest, ApiResponse, PlaceOrderRequest, TradingMode } from '../../types';

const router = Router();

/**
 * @swagger
 * /trading/mode:
 *   get:
 *     tags: [Trading]
 *     summary: Get current trading mode (PAPER or LIVE)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/mode', authenticate, async (_req, res: Response): Promise<void> => {
  const mode = await tradingService.getCurrentMode();
  res.json(<ApiResponse>{ success: true, data: { mode } });
});

/**
 * @swagger
 * /trading/mode:
 *   put:
 *     tags: [Trading]
 *     summary: Switch trading mode — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.put(
  '/mode',
  authenticate,
  authorize('ADMIN'),
  auditLog('SWITCH_MODE', 'settings'),
  [body('mode').isIn(['PAPER', 'LIVE'])],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json(<ApiResponse>{ success: false, errors: errors.mapped() });
      return;
    }
    const { mode } = req.body as { mode: TradingMode };
    await tradingService.setMode(mode);
    res.json(<ApiResponse>{ success: true, data: { mode }, message: `Switched to ${mode} mode` });
  },
);

/**
 * @swagger
 * /trading/orders:
 *   post:
 *     tags: [Trading]
 *     summary: Place a new order (paper or live based on current mode)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/orders',
  authenticate,
  authorize('ADMIN', 'TRADER'),
  orderLimiter,
  [
    body('symbol').notEmpty(),
    body('exchange').notEmpty(),
    body('instrumentToken').notEmpty(),
    body('side').isIn(['BUY', 'SELL']),
    body('qty').isInt({ min: 1 }),
    body('orderType').isIn(['MARKET', 'LIMIT', 'SL', 'SL_M']),
    body('product').isIn(['MIS', 'CNC', 'NRML']),
    body('currentPrice').isFloat({ min: 0.01 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json(<ApiResponse>{ success: false, errors: errors.mapped() });
      return;
    }
    const user = (req as AuthRequest).user;
    const { currentPrice, ...orderData } = req.body as PlaceOrderRequest & { currentPrice: number };
    const result = await tradingService.placeOrder(user.sub, orderData, currentPrice);
    res.status(201).json(<ApiResponse>{ success: true, data: result });
  },
);

/**
 * @swagger
 * /trading/orders:
 *   get:
 *     tags: [Trading]
 *     summary: List orders with optional filters
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  '/orders',
  authenticate,
  [
    query('mode').optional().isIn(['PAPER', 'LIVE']),
    query('status').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as AuthRequest).user;
    const { mode, status, symbol, limit, offset } = req.query as Record<string, string>;
    const result = await tradingService.getOrders(user.sub, {
      mode: mode as TradingMode,
      status,
      symbol,
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
    });
    res.json(<ApiResponse>{ success: true, data: result.orders, meta: { total: result.total } });
  },
);

/**
 * @swagger
 * /trading/orders/{id}/cancel:
 *   post:
 *     tags: [Trading]
 *     summary: Cancel an open order
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/orders/:id/cancel',
  authenticate,
  authorize('ADMIN', 'TRADER'),
  auditLog('CANCEL_ORDER', 'orders'),
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as AuthRequest).user;
    await tradingService.cancelOrder(req.params['id']!, user.sub);
    res.json(<ApiResponse>{ success: true, message: 'Order cancelled' });
  },
);

/**
 * @swagger
 * /trading/trades:
 *   get:
 *     tags: [Trading]
 *     summary: List trades with summary statistics
 *     security: [{ bearerAuth: [] }]
 */
router.get('/trades', authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthRequest).user;
  const { mode, symbol, limit, offset } = req.query as Record<string, string>;
  const result = await tradingService.getTrades(user.sub, {
    mode: mode as TradingMode,
    symbol,
    limit: limit ? Number(limit) : 100,
    offset: offset ? Number(offset) : 0,
  });
  res.json(<ApiResponse>{
    success: true,
    data: { trades: result.trades, summary: result.summary },
    meta: { total: result.total },
  });
});

/**
 * @swagger
 * /trading/positions:
 *   get:
 *     tags: [Trading]
 *     summary: Get all open positions
 *     security: [{ bearerAuth: [] }]
 */
router.get('/positions', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { mode } = req.query as { mode?: TradingMode };
  const positions = await tradingService.getPositions(mode);
  res.json(<ApiResponse>{ success: true, data: positions });
});

/**
 * @swagger
 * /trading/summary:
 *   get:
 *     tags: [Trading]
 *     summary: Dashboard summary — P&L, positions, equity
 *     security: [{ bearerAuth: [] }]
 */
router.get('/summary', authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthRequest).user;
  const summary = await tradingService.getDashboardSummary(user.sub);
  res.json(<ApiResponse>{ success: true, data: summary });
});

/**
 * @swagger
 * /trading/risk/status:
 *   get:
 *     tags: [Trading]
 *     summary: Get risk manager status
 *     security: [{ bearerAuth: [] }]
 */
router.get('/risk/status', authenticate, (_req, res: Response): void => {
  res.json(<ApiResponse>{ success: true, data: { circuitBreakerActive: riskManager.isActive() } });
});

/**
 * @swagger
 * /trading/risk/reset-circuit-breaker:
 *   post:
 *     tags: [Trading]
 *     summary: Reset circuit breaker — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/risk/reset-circuit-breaker',
  authenticate,
  authorize('ADMIN'),
  auditLog('RESET_CIRCUIT_BREAKER', 'settings'),
  async (_req, res: Response): Promise<void> => {
    await riskManager.resetCircuitBreaker();
    res.json(<ApiResponse>{ success: true, message: 'Circuit breaker reset — trading resumed' });
  },
);

export default router;
