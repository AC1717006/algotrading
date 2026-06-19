import { Router, Response } from 'express';
import { prisma, redis } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { strategyEngine } from '../strategies/strategy.engine';
import { paperEngine } from '../trading/paper-engine';
import { config } from '../../config';
import { ApiResponse } from '../../types';

const router = Router();

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface ServiceCheck {
  status: HealthStatus;
  detail?: string | number | Record<string, unknown>;
}

interface FullHealthReport {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  services: Record<string, ServiceCheck>;
  system: {
    memory: NodeJS.MemoryUsage;
    cpu: NodeJS.CpuUsage;
  };
}

async function checkDb(): Promise<ServiceCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', detail: 'PostgreSQL connected' };
  } catch (err) {
    return { status: 'unhealthy', detail: (err as Error).message };
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  try {
    const pong = await redis.ping();
    return { status: pong === 'PONG' ? 'healthy' : 'degraded', detail: pong };
  } catch (err) {
    return { status: 'unhealthy', detail: (err as Error).message };
  }
}

function checkUpstoxToken(): ServiceCheck {
  const token = config.UPSTOX_ACCESS_TOKEN ?? '';
  if (token.length > 10) {
    return { status: 'healthy', detail: `Token length: ${token.length}` };
  }
  return { status: 'degraded', detail: 'Access token missing or too short' };
}

function checkStrategyEngine(): ServiceCheck {
  const ids = strategyEngine.runningIds();
  return { status: 'healthy', detail: { runningStrategies: ids.length, ids } };
}

async function checkPaperEngine(): Promise<ServiceCheck> {
  try {
    // Use admin/first trader user
    const user = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'TRADER'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) return { status: 'degraded', detail: 'No active trader/admin user found' };
    const balance = await paperEngine.getBalance(user.id);
    return { status: 'healthy', detail: { balance } };
  } catch (err) {
    return { status: 'degraded', detail: (err as Error).message };
  }
}

async function checkUpstoxApi(): Promise<ServiceCheck> {
  try {
    const metrics = upstoxClient.getMetrics();
    const status: HealthStatus = metrics.rateLimitUsagePct > 80 ? 'degraded' : 'healthy';
    return { status, detail: metrics as unknown as Record<string, unknown> };
  } catch (err) {
    return { status: 'degraded', detail: (err as Error).message };
  }
}

/**
 * @swagger
 * /health/full:
 *   get:
 *     tags: [Health]
 *     summary: Full system health check — checks DB, Redis, Upstox, strategies, paper engine
 */
router.get('/full', async (_req, res: Response): Promise<void> => {
  const [db, redisCheck, paper, upstoxApi] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkPaperEngine(),
    checkUpstoxApi(),
  ]);

  const token      = checkUpstoxToken();
  const strategies = checkStrategyEngine();

  const services: Record<string, ServiceCheck> = {
    database:       db,
    redis:          redisCheck,
    upstoxToken:    token,
    upstoxApi,
    strategyEngine: strategies,
    paperEngine:    paper,
    process: {
      status: 'healthy',
      detail: { uptimeSeconds: Math.round(process.uptime()) },
    },
  };

  // Overall status: unhealthy if any service is unhealthy, degraded if any is degraded
  const statuses = Object.values(services).map((s) => s.status);
  const overallStatus: HealthStatus = statuses.includes('unhealthy')
    ? 'unhealthy'
    : statuses.includes('degraded')
    ? 'degraded'
    : 'healthy';

  const report: FullHealthReport = {
    status:    overallStatus,
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    services,
    system: {
      memory: process.memoryUsage(),
      cpu:    process.cpuUsage(),
    },
  };

  const httpStatus = overallStatus === 'unhealthy' ? 503 : overallStatus === 'degraded' ? 200 : 200;
  res.status(httpStatus).json({ success: overallStatus !== 'unhealthy', data: report } as ApiResponse);
});

export default router;
