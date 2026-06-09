import { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/client';
import { AuthRequest } from '../types';

export function auditLog(action: string, resource: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user) { next(); return; }

    const originalJson = res.json.bind(res) as (body: unknown) => Response;
    res.json = (body: unknown): Response => {
      if (res.statusCode < 400) {
        prisma.auditLog
          .create({
            data: {
              userId: user.sub,
              action,
              resource,
              resourceId: req.params['id'] ?? null,
              meta: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
              ipAddress: req.ip ?? req.socket.remoteAddress,
              userAgent: req.headers['user-agent'],
            },
          })
          .catch(() => void 0);
      }
      return originalJson(body);
    };

    next();
  };
}
