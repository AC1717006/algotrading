import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { s3Service } from './s3.service';
import { tradingService } from '../trading/trading.service';
import { AuthRequest, ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /s3/reports/download:
 *   get:
 *     tags: [S3]
 *     summary: Get presigned URL to download trade report for a date
 *     security: [{ bearerAuth: [] }]
 */
router.get('/reports/download', authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthRequest).user;
  const { date } = req.query as { date?: string };
  const targetDate = date ?? new Date().toISOString().split('T')[0]!;

  const url = await s3Service.getTradeReportUrl(user.sub, targetDate);
  if (!url) {
    res.status(404).json(<ApiResponse>{ success: false, message: 'Report not found or S3 not configured' });
    return;
  }
  res.json(<ApiResponse>{ success: true, data: { url, expiresIn: 3600 } });
});

/**
 * @swagger
 * /s3/reports/generate:
 *   post:
 *     tags: [S3]
 *     summary: Generate and upload today's trade report to S3
 *     security: [{ bearerAuth: [] }]
 */
router.post('/reports/generate', authenticate, authorize('ADMIN', 'TRADER'), async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthRequest).user;
  const { mode } = req.query as { mode?: 'PAPER' | 'LIVE' };

  const { trades } = await tradingService.getTrades(user.sub, { mode, limit: 10000 });

  // Build CSV
  const header = 'Date,Symbol,Side,Qty,EntryPrice,ExitPrice,PnL,Charges,Mode\n';
  const rows = trades.map((t) => [
    t.createdAt.toISOString(),
    t.symbol,
    t.side,
    t.qty,
    t.entryPrice,
    t.exitPrice ?? '',
    t.pnl ?? '',
    t.charges,
    t.mode,
  ].join(',')).join('\n');

  const result = await s3Service.uploadTradeReport(user.sub, header + rows);
  if (!result) {
    res.status(503).json(<ApiResponse>{ success: false, message: 'S3 upload failed or not configured' });
    return;
  }
  res.json(<ApiResponse>{ success: true, data: result });
});

/**
 * @swagger
 * /s3/files:
 *   get:
 *     tags: [S3]
 *     summary: List files in S3 by prefix — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.get('/files', authenticate, authorize('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const { prefix = '' } = req.query as { prefix?: string };
  const files = await s3Service.listObjects(prefix);
  res.json(<ApiResponse>{ success: true, data: files });
});

/**
 * @swagger
 * /s3/presign:
 *   get:
 *     tags: [S3]
 *     summary: Get a presigned URL for any S3 key — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.get('/presign', authenticate, authorize('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const { key, expires } = req.query as { key?: string; expires?: string };
  if (!key) {
    res.status(400).json(<ApiResponse>{ success: false, message: 'key query param required' });
    return;
  }
  const url = await s3Service.getPresignedUrl(key, expires ? Number(expires) : 3600);
  if (!url) {
    res.status(404).json(<ApiResponse>{ success: false, message: 'Object not found or S3 not configured' });
    return;
  }
  res.json(<ApiResponse>{ success: true, data: { url } });
});

export default router;
