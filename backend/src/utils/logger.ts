import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  errors({ stack: true }),
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  printf(({ level, message, timestamp, stack, category, ...meta }) => {
    const cat = category ? ` [${category}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} ${level}${cat}: ${message}${metaStr}${stackStr}`;
  }),
);

const prodFormat = combine(errors({ stack: true }), timestamp(), json());

export const logger = winston.createLogger({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  format: config.NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'algo-trading' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 10_000_000, maxFiles: 5 }),
    new winston.transports.File({ filename: 'logs/combined.log', maxsize: 50_000_000, maxFiles: 10 }),
  ],
  exceptionHandlers: [new winston.transports.File({ filename: 'logs/exceptions.log' })],
  rejectionHandlers: [new winston.transports.File({ filename: 'logs/rejections.log' })],
});

export function createLogger(category: string) {
  return logger.child({ category });
}
