import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { isTokenBlacklisted } from '../database/client';
import { JwtPayload, AuthRequest, ApiResponse } from '../types';
import { UserRole } from '@prisma/client';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json(<ApiResponse>{
      success: false,
      message: 'Missing or malformed Authorization header',
    });
    return;
  }

  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
  } catch (err) {
    const msg = err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token';
    res.status(401).json(<ApiResponse>{ success: false, message: msg });
    return;
  }

  // Check Redis blacklist
  try {
    if (await isTokenBlacklisted(payload.jti)) {
      res.status(401).json(<ApiResponse>{ success: false, message: 'Token has been revoked' });
      return;
    }
  } catch {
    // Redis unavailable — allow the request but log
    // In production you may want to block here
  }

  (req as AuthRequest).user = payload;
  next();
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json(<ApiResponse>{ success: false, message: 'Not authenticated' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json(<ApiResponse>{
        success: false,
        message: `Role '${user.role}' is not authorized for this action`,
      });
      return;
    }
    next();
  };
}
