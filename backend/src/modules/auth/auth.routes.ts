import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authService } from './auth.service';
import { authenticate, authorize } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import { auditLog } from '../../middleware/auditLog';
import { AuthRequest, ApiResponse } from '../../types';

const router = Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and obtain JWT access + refresh tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful — returns accessToken (15m) + refreshToken (7d)
 *       401:
 *         description: Invalid credentials
 */
router.post(
  '/login',
  authLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login(email, password);
    res.json(<ApiResponse>{ success: true, data: result });
  },
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange refresh token for a new access token
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json(<ApiResponse>{ success: false, message: 'refreshToken is required' });
    return;
  }
  const result = await authService.refresh(refreshToken);
  res.json(<ApiResponse>{ success: true, data: result });
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout — blacklist current access token
 *     security: [{ bearerAuth: [] }]
 */
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  const token = req.headers.authorization?.slice(7) ?? '';
  await authService.logout(token);
  res.json(<ApiResponse>{ success: true, message: 'Logged out successfully' });
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 *     security: [{ bearerAuth: [] }]
 */
router.get('/me', authenticate, (req: Request, res: Response): void => {
  const { sub, email, role } = (req as AuthRequest).user;
  res.json(<ApiResponse>{ success: true, data: { id: sub, email, role } });
});

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/change-password',
  authenticate,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 8 })],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const user = (req as AuthRequest).user;
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    await authService.changePassword(user.sub, currentPassword, newPassword);
    res.json(<ApiResponse>{ success: true, message: 'Password changed successfully' });
  },
);

/**
 * @swagger
 * /auth/users:
 *   get:
 *     tags: [Auth]
 *     summary: List all users (Admin only)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/users', authenticate, authorize('ADMIN'), async (_req, res: Response): Promise<void> => {
  const users = await authService.listUsers();
  res.json(<ApiResponse>{ success: true, data: users });
});

/**
 * @swagger
 * /auth/users:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new user (Admin only)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/users',
  authenticate,
  authorize('ADMIN'),
  auditLog('CREATE_USER', 'users'),
  [body('email').isEmail(), body('password').isLength({ min: 8 }), body('role').isIn(['ADMIN', 'TRADER', 'VIEWER'])],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.mapped() } as any);
      return;
    }
    const { email, password, role } = req.body as { email: string; password: string; role: 'ADMIN' | 'TRADER' | 'VIEWER' };
    const user = await authService.createUser(email, password, role);
    res.status(201).json(<ApiResponse>{ success: true, data: user });
  },
);

export default router;
