import { Router, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { systemMetricsService } from './system.service';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /system/metrics:
 *   get:
 *     tags: [System]
 *     summary: Get system health metrics — Upstox API latency/rate-limit usage and active strategy risk exposure
 *     security: [{ bearerAuth: [] }]
 */
router.get('/metrics', authenticate, async (_req, res: Response): Promise<void> => {
  const data = await systemMetricsService.getMetrics();
  res.json(<ApiResponse>{ success: true, data });
});

export default router;
