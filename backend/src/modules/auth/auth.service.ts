import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma, blacklistToken } from '../../database/client';
import { config } from '../../config';
import { AppError } from '../../middleware/errorHandler';
import { JwtPayload } from '../../types';
import { UserRole } from '@prisma/client';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResult extends TokenPair {
  user: { id: string; email: string; role: UserRole };
}

function signAccess(payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>): string {
  const jti = uuidv4();
  return jwt.sign({ ...payload, jti }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function signRefresh(payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>): string {
  const jti = uuidv4();
  return jwt.sign({ ...payload, jti }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export class AuthService {
  async login(email: string, password: string): Promise<AuthResult> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password');
    }

    const base = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: signAccess(base),
      refreshToken: signRefresh(base),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JwtPayload;
    } catch {
      throw new AppError(401, 'Invalid or expired refresh token');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new AppError(401, 'User not found or inactive');
    }

    const base = { sub: user.id, email: user.email, role: user.role };
    return { accessToken: signAccess(base) };
  }

  async logout(accessToken: string): Promise<void> {
    try {
      const payload = jwt.verify(accessToken, config.JWT_SECRET) as JwtPayload;
      const ttl = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await blacklistToken(payload.jti, ttl);
      }
    } catch {
      // Already expired — nothing to blacklist
    }
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.password))) {
      throw new AppError(400, 'Current password is incorrect');
    }
    const hash = await bcrypt.hash(next, 12);
    await prisma.user.update({ where: { id: userId }, data: { password: hash } });
  }

  async createUser(email: string, password: string, role: UserRole): Promise<{ id: string; email: string; role: UserRole }> {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError(409, 'Email already registered');
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, password: hash, role } });
    return { id: user.id, email: user.email, role: user.role };
  }

  async listUsers() {
    return prisma.user.findMany({
      select: { id: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleUser(id: string, isActive: boolean): Promise<void> {
    await prisma.user.update({ where: { id }, data: { isActive } });
  }
}

export const authService = new AuthService();
