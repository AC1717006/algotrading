import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Prisma singleton ────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log:
      config.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  });

if (config.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}


export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('PostgreSQL connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

// ─── Redis singleton ─────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

export const redis =
  global.__redis ??
  new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

if (config.NODE_ENV !== 'production') {
  global.__redis = redis;
}

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err: Error) => logger.error('Redis error', { message: err.message }));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

// ─── Token blacklist helpers (using Redis) ───────────────────────────────────
const BLACKLIST_PREFIX = 'token:blacklist:';

export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  await redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const result = await redis.get(`${BLACKLIST_PREFIX}${jti}`);
  return result !== null;
}

// ─── General cache helpers ───────────────────────────────────────────────────
export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  await redis.set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(`cache:${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheDel(key: string): Promise<void> {
  await redis.del(`cache:${key}`);
}
