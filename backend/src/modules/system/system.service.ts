import { prisma } from '../../database/client';
import { upstoxClient } from '../broker/upstox.client';
import { riskManager } from '../risk/risk-manager';
import { StrategyRiskConfig } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'SystemMetrics' });

export interface RiskExposureMetrics {
  activeStrategies: number;
  totalRiskBudget: number;
  equity: number;
  openPositionsValue: number;
  exposurePct: number;
  circuitBreakerActive: boolean;
}

export class SystemMetricsService {
  async getMetrics() {
    return {
      latency: upstoxClient.getMetrics(),
      riskExposure: await this.getRiskExposure(),
    };
  }

  private async getRiskExposure(): Promise<RiskExposureMetrics> {
    const activeStrategies = await prisma.strategy.findMany({ where: { isActive: true } });
    const totalRiskBudget = activeStrategies.reduce((sum, s) => {
      const cfg = s.riskConfig as unknown as StrategyRiskConfig;
      return sum + (cfg?.maxPositionValue ?? 0);
    }, 0);

    let equity = 0;
    try {
      const funds = await upstoxClient.getFunds() as { equity?: { available_margin?: number } };
      equity = funds?.equity?.available_margin ?? 0;
    } catch {
      log.warn('Could not fetch funds for risk exposure metric');
    }

    const openPositions = await prisma.position.findMany({ where: { isOpen: true } });
    const openPositionsValue = openPositions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);

    return {
      activeStrategies: activeStrategies.length,
      totalRiskBudget,
      equity,
      openPositionsValue,
      exposurePct: equity > 0 ? Math.round((totalRiskBudget / equity) * 1000) / 10 : 0,
      circuitBreakerActive: riskManager.isActive(),
    };
  }
}

export const systemMetricsService = new SystemMetricsService();
