import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json(<ApiResponse>{
      success: false,
      message: err.message,
    });
    return;
  }

  // Unexpected error — log full details
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json(<ApiResponse>{
    success: false,
    message: 'Internal server error',
  });
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json(<ApiResponse>{
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
