import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../../middleware/auth';
import { backtestService } from './backtest.service';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /backtest/run:
 *   post:
 *     tags: [Backtest]
 *     summary: Run a backtest for a strategy
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/run',
  authenticate,
  authorize('ADMIN', 'TRADER'),
  [
    body('strategyType').notEmpty(),
    body('symbol').notEmpty(),
    body('exchange').notEmpty(),
    body('fromDate').isDate(),
    body('toDate').isDate(),
    body('capital').isFloat({ min: 1000 }),
    body('brokerage').optional().isFloat({ min: 0, max: 0.01 }),
    body('slippage').optional().isFloat({ min: 0 }),
    body('parameters').optional().isObject(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as unknown as ApiResponse);
      return;
    }

    const {
      strategyType,
      symbol,
      exchange,
      fromDate,
      toDate,
      capital,
      brokerage = 0.0003,
      slippage  = 1,
      parameters = {},
    } = req.body as {
      strategyType: string;
      symbol: string;
      exchange: string;
      fromDate: string;
      toDate: string;
      capital: number;
      brokerage?: number;
      slippage?: number;
      parameters?: Record<string, unknown>;
    };

    const result = await backtestService.run({
      strategyType,
      symbol,
      exchange,
      fromDate,
      toDate,
      capital,
      brokerage,
      slippage,
      parameters,
    });

    res.status(201).json({ success: true, data: result } as ApiResponse);
  },
);

/**
 * @swagger
 * /backtest/results/{id}:
 *   get:
 *     tags: [Backtest]
 *     summary: Get a previously run backtest result
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  '/results/:id',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const result = await backtestService.getResult(req.params['id']!);
    if (!result) {
      res.status(404).json({ success: false, message: 'Backtest result not found' } as ApiResponse);
      return;
    }
    res.json({ success: true, data: result } as ApiResponse);
  },
);

export default router;
