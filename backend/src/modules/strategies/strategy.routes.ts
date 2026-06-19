import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../../middleware/auth';
import { auditLog } from '../../middleware/auditLog';
import { prisma } from '../../database/client';
import { strategyEngine } from './strategy.engine';
import { AppError } from '../../middleware/errorHandler';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /strategies:
 *   get:
 *     tags: [Strategies]
 *     summary: List all strategies
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', authenticate, async (_req, res: Response): Promise<void> => {
  const strategies = await prisma.strategy.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(<ApiResponse>{ success: true, data: strategies });
});

/**
 * @swagger
 * /strategies:
 *   post:
 *     tags: [Strategies]
 *     summary: Create a new strategy — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  auditLog('CREATE_STRATEGY', 'strategies'),
  [
    body('name').notEmpty(),
    body('type').isIn(['EMA_CROSSOVER', 'RSI', 'MACD', 'BREAKOUT', 'CUSTOM', 'THREE_CANDLE_MOMENTUM']),
    body('symbol').notEmpty(),
    body('exchange').notEmpty(),
    body('timeframe').notEmpty(),
    body('parameters').isObject(),
    body('riskConfig').isObject(),
    body('mode').isIn(['PAPER', 'LIVE']),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const strategy = await prisma.strategy.create({ data: req.body });
    res.status(201).json(<ApiResponse>{ success: true, data: strategy });
  },
);

/**
 * @swagger
 * /strategies/{id}:
 *   get:
 *     tags: [Strategies]
 *     summary: Get a strategy by ID
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const strategy = await prisma.strategy.findUnique({ where: { id: req.params['id']! } });
  if (!strategy) throw new AppError(404, 'Strategy not found');
  res.json(<ApiResponse>{ success: true, data: strategy });
});

/**
 * @swagger
 * /strategies/{id}:
 *   put:
 *     tags: [Strategies]
 *     summary: Update a strategy — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.put('/:id', authenticate, authorize('ADMIN'), auditLog('UPDATE_STRATEGY', 'strategies'), async (req: Request, res: Response): Promise<void> => {
  const strategy = await prisma.strategy.update({ where: { id: req.params['id']! }, data: req.body });
  res.json(<ApiResponse>{ success: true, data: strategy });
});

/**
 * @swagger
 * /strategies/{id}/enable:
 *   post:
 *     tags: [Strategies]
 *     summary: Enable and start a strategy
 *     security: [{ bearerAuth: [] }]
 */
router.post('/:id/enable', authenticate, authorize('ADMIN', 'TRADER'), auditLog('ENABLE_STRATEGY', 'strategies'), async (req: Request, res: Response): Promise<void> => {
  await prisma.strategy.update({ where: { id: req.params['id']! }, data: { isActive: true } });
  await strategyEngine.startStrategy(req.params['id']!);
  res.json(<ApiResponse>{ success: true, message: 'Strategy enabled and running' });
});

/**
 * @swagger
 * /strategies/{id}/disable:
 *   post:
 *     tags: [Strategies]
 *     summary: Disable and stop a strategy
 *     security: [{ bearerAuth: [] }]
 */
router.post('/:id/disable', authenticate, authorize('ADMIN', 'TRADER'), auditLog('DISABLE_STRATEGY', 'strategies'), async (req: Request, res: Response): Promise<void> => {
  await prisma.strategy.update({ where: { id: req.params['id']! }, data: { isActive: false } });
  await strategyEngine.stopStrategy(req.params['id']!);
  res.json(<ApiResponse>{ success: true, message: 'Strategy disabled' });
});

/**
 * @swagger
 * /strategies/{id}/signals:
 *   get:
 *     tags: [Strategies]
 *     summary: Get recent signals for a strategy
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id/signals', authenticate, async (req: Request, res: Response): Promise<void> => {
  const signals = await prisma.signal.findMany({
    where: { strategyId: req.params['id']! },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(<ApiResponse>{ success: true, data: signals });
});

/**
 * @swagger
 * /strategies/{id}:
 *   delete:
 *     tags: [Strategies]
 *     summary: Delete a strategy — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.delete('/:id', authenticate, authorize('ADMIN'), auditLog('DELETE_STRATEGY', 'strategies'), async (req: Request, res: Response): Promise<void> => {
  await strategyEngine.stopStrategy(req.params['id']!);
  await prisma.strategy.delete({ where: { id: req.params['id']! } });
  res.json(<ApiResponse>{ success: true, message: 'Strategy deleted' });
});

export default router;
