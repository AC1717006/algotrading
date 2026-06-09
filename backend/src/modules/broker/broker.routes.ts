import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../../middleware/auth';
import { auditLog } from '../../middleware/auditLog';
import { brokerService } from './broker.service';
import { upstoxClient } from './upstox.client';
import { config } from '../../config';
import { ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /broker/auth:
 *   get:
 *     tags: [Broker]
 *     summary: Redirect to Upstox OAuth authorization page
 *     security: [{ bearerAuth: [] }]
 */
router.get('/auth', authenticate, authorize('ADMIN'), (_req, res: Response): void => {
  const url = upstoxClient.getAuthorizationUrl();
  res.redirect(url);
});

/**
 * @swagger
 * /broker/auth-url:
 *   get:
 *     tags: [Broker]
 *     summary: Get Upstox OAuth URL as JSON (for frontend-driven OAuth flow)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/auth-url', authenticate, authorize('ADMIN'), (_req, res: Response): void => {
  const url = upstoxClient.getAuthorizationUrl();
  res.json(<ApiResponse>{ success: true, data: { url } });
});

/**
 * @swagger
 * /broker/callback:
 *   get:
 *     tags: [Broker]
 *     summary: Upstox OAuth callback — exchanges code for access token
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error || !code) {
    res.redirect(`${config.FRONTEND_URL}/dashboard?broker=error&reason=${error ?? 'no_code'}`);
    return;
  }

  await brokerService.handleOAuthCallback(code);
  res.redirect(`${config.FRONTEND_URL}/dashboard?broker=connected`);
});

/**
 * @swagger
 * /broker/validate:
 *   get:
 *     tags: [Broker]
 *     summary: Validate current Upstox access token
 *     security: [{ bearerAuth: [] }]
 */
router.get('/validate', authenticate, async (_req, res: Response): Promise<void> => {
  const valid = await brokerService.validateToken();
  res.json(<ApiResponse>{ success: true, data: { valid } });
});

/**
 * @swagger
 * /broker/token:
 *   post:
 *     tags: [Broker]
 *     summary: Manually update Upstox access token (Admin only)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/token',
  authenticate,
  authorize('ADMIN'),
  auditLog('UPDATE_BROKER_TOKEN', 'settings'),
  [body('accessToken').notEmpty().withMessage('accessToken is required')],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { accessToken } = req.body as { accessToken: string };
    await brokerService.saveToken(accessToken);
    res.json(<ApiResponse>{ success: true, message: 'Access token updated and saved' });
  },
);

/**
 * @swagger
 * /broker/account:
 *   get:
 *     tags: [Broker]
 *     summary: Get full account summary from Upstox
 *     security: [{ bearerAuth: [] }]
 */
router.get('/account', authenticate, async (_req, res: Response): Promise<void> => {
  const summary = await brokerService.getAccountSummary();
  res.json(<ApiResponse>{ success: true, data: summary });
});

/**
 * @swagger
 * /broker/orders:
 *   get:
 *     tags: [Broker]
 *     summary: Fetch live order history from Upstox
 *     security: [{ bearerAuth: [] }]
 */
router.get('/orders', authenticate, async (_req, res: Response): Promise<void> => {
  const orders = await upstoxClient.getOrderHistory();
  res.json(<ApiResponse>{ success: true, data: orders });
});

export default router;
