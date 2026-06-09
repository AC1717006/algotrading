import rateLimit from 'express-rate-limit';
import { ApiResponse } from '../types';

const json = (msg: string): ApiResponse => ({ success: false, message: msg });

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('Too many requests — please slow down.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('Too many login attempts — try again in 15 minutes.'),
  skipSuccessfulRequests: false,
});

export const orderLimiter = rateLimit({
  windowMs: 1_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('Order rate limit exceeded — max 10 orders/second.'),
});
