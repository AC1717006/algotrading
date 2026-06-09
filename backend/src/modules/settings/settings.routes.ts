import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../../middleware/auth';
import { auditLog } from '../../middleware/auditLog';
import { prisma } from '../../database/client';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Get all settings as a key-value map
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', authenticate, async (_req, res: Response): Promise<void> => {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  const map = Object.fromEntries(rows.map((r) => [r.key, { value: r.value, description: r.description }]));
  res.json(<ApiResponse>{ success: true, data: map });
});

/**
 * @swagger
 * /settings/{key}:
 *   get:
 *     tags: [Settings]
 *     summary: Get a single setting by key
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:key', authenticate, async (req: Request, res: Response): Promise<void> => {
  const row = await prisma.setting.findUnique({ where: { key: req.params['key']! } });
  if (!row) {
    res.status(404).json(<ApiResponse>{ success: false, message: 'Setting not found' });
    return;
  }
  res.json(<ApiResponse>{ success: true, data: row });
});

/**
 * @swagger
 * /settings/{key}:
 *   put:
 *     tags: [Settings]
 *     summary: Update a setting value — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.put(
  '/:key',
  authenticate,
  authorize('ADMIN'),
  auditLog('UPDATE_SETTING', 'settings'),
  [body('value').notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json(<ApiResponse>{ success: false, errors: errors.mapped() });
      return;
    }
    const { value } = req.body as { value: string };
    const row = await prisma.setting.update({ where: { key: req.params['key']! }, data: { value: String(value) } });
    res.json(<ApiResponse>{ success: true, data: row });
  },
);

/**
 * @swagger
 * /settings/bulk:
 *   put:
 *     tags: [Settings]
 *     summary: Bulk update multiple settings — Admin only
 *     security: [{ bearerAuth: [] }]
 */
router.put('/bulk/update', authenticate, authorize('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const updates = req.body as Record<string, string>;
  const results: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const row = await prisma.setting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value), description: '' },
    }).catch(() => null);
    if (row) results.push(row);
  }
  res.json(<ApiResponse>{ success: true, data: results });
});

export default router;
