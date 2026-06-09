import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (works for dev and dist/)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Upstox
  UPSTOX_API_KEY: z.string().min(1, 'UPSTOX_API_KEY is required'),
  UPSTOX_API_SECRET: z.string().min(1, 'UPSTOX_API_SECRET is required'),
  UPSTOX_ACCESS_TOKEN: z.string().default(''),
  UPSTOX_REDIRECT_URI: z.string().url(),
  UPSTOX_BASE_URL: z.string().url().default('https://api.upstox.com/v2'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),

  // AWS S3
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_BUCKET: z.string().default(''),

  // Trading
  PAPER_TRADING_INITIAL_BALANCE: z.coerce.number().default(1_000_000),

  // Risk
  MAX_DAILY_LOSS_PERCENT: z.coerce.number().default(2),
  MAX_TRADES_PER_DAY: z.coerce.number().default(20),
  MAX_POSITION_SIZE_PERCENT: z.coerce.number().default(10),
  CIRCUIT_BREAKER_LOSS_PERCENT: z.coerce.number().default(5),

  // Seed
  ADMIN_EMAIL: z.string().email().default('admin@algotrader.com'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMe@123'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment configuration:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
