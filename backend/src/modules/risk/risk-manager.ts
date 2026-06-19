import { prisma } from '../../database/client';
import { logger } from '../../utils/logger';
import { telegramService } from '../notifications/telegram.service';
import { PlaceOrderRequest, RiskCheckResult, TradingMode } from '../../types';

const log = logger.child({ category: 'RiskManager' });

interface RiskSettings {
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  maxPositionSizePct: number;
  circuitBreakerLossPct: number;
  // Phase 4 additions
  maxOpenPositions: number;
  tradeCooldownMinutes: number;
  riskPerTradePct: number;
  killSwitchActive: boolean;
}

export class RiskManager {
  private circuitBreakerActive = false;
  private settings: RiskSettings = {
    maxDailyLossPct:       2,
    maxTradesPerDay:        20,
    maxPositionSizePct:    10,
    circuitBreakerLossPct:  5,
    maxOpenPositions:       3,
    tradeCooldownMinutes:  15,
    riskPerTradePct:        1,
    killSwitchActive:      false,
  };

  async loadSettings(): Promise<void> {
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            'max_daily_loss_pct',
            'max_trades_per_day',
            'max_position_size_pct',
            'circuit_breaker_loss_pct',
            'circuit_breaker_active',
            'max_open_positions',
            'trade_cooldown_minutes',
            'risk_per_trade_pct',
            'kill_switch_active',
          ],
        },
      },
    });
    for (const row of rows) {
      switch (row.key) {
        case 'max_daily_loss_pct':       this.settings.maxDailyLossPct       = Number(row.value); break;
        case 'max_trades_per_day':        this.settings.maxTradesPerDay        = Number(row.value); break;
        case 'max_position_size_pct':     this.settings.maxPositionSizePct     = Number(row.value); break;
        case 'circuit_breaker_loss_pct':  this.settings.circuitBreakerLossPct  = Number(row.value); break;
        case 'circuit_breaker_active':    this.circuitBreakerActive             = row.value === 'true'; break;
        case 'max_open_positions':        this.settings.maxOpenPositions        = Number(row.value); break;
        case 'trade_cooldown_minutes':    this.settings.tradeCooldownMinutes    = Number(row.value); break;
        case 'risk_per_trade_pct':        this.settings.riskPerTradePct         = Number(row.value); break;
        case 'kill_switch_active':        this.settings.killSwitchActive        = row.value === 'true'; break;
      }
    }
  }

  async check(
    userId: string,
    order: PlaceOrderRequest,
    currentPrice: number,
    accountEquity: number,
    mode: TradingMode,
  ): Promise<RiskCheckResult> {
    await this.loadSettings();

    // 0. Kill switch — blocks ALL orders immediately
    if (this.settings.killSwitchActive) {
      return { passed: false, reason: 'Kill switch is active — all trading immediately halted' };
    }

    // 1. Circuit breaker
    if (this.circuitBreakerActive) {
      return { passed: false, reason: 'Circuit breaker is active — all trading halted for this session' };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 2. Daily trade count
    const todayOrderCount = await prisma.order.count({
      where: {
        userId,
        mode,
        placedAt: { gte: todayStart },
        status: { notIn: ['REJECTED', 'CANCELLED'] },
      },
    });
    if (todayOrderCount >= this.settings.maxTradesPerDay) {
      return {
        passed: false,
        reason: `Daily trade limit reached: ${todayOrderCount}/${this.settings.maxTradesPerDay}`,
      };
    }

    // 3. Daily P&L check
    const todayTrades = await prisma.trade.findMany({
      where: { order: { userId }, mode, createdAt: { gte: todayStart } },
      select: { pnl: true },
    });
    const dailyPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const dailyLossLimit = -(accountEquity * this.settings.maxDailyLossPct) / 100;

    if (dailyPnl <= dailyLossLimit) {
      // Check if should trip circuit breaker
      const circuitLimit = -(accountEquity * this.settings.circuitBreakerLossPct) / 100;
      if (dailyPnl <= circuitLimit) {
        await this.tripCircuitBreaker(dailyPnl, accountEquity);
      }
      return {
        passed: false,
        reason: `Daily loss limit reached: ₹${Math.abs(dailyPnl).toFixed(2)} / ₹${Math.abs(dailyLossLimit).toFixed(2)}`,
      };
    }

    // 4. Max position size
    const orderValue = (order.qty ?? 1) * currentPrice;
    const maxAllowed = (accountEquity * this.settings.maxPositionSizePct) / 100;
    if (orderValue > maxAllowed) {
      return {
        passed: false,
        reason: `Order value ₹${orderValue.toFixed(2)} exceeds max position size ₹${maxAllowed.toFixed(2)} (${this.settings.maxPositionSizePct}% of ₹${accountEquity.toFixed(2)})`,
      };
    }

    // 5. Max open positions (Phase 4)
    if (this.settings.maxOpenPositions > 0) {
      const openCount = await prisma.position.count({
        where: { mode, isOpen: true },
      });
      if (openCount >= this.settings.maxOpenPositions) {
        return {
          passed: false,
          reason: `Max open positions reached: ${openCount}/${this.settings.maxOpenPositions}`,
        };
      }
    }

    // 6. Trade cooldown — block re-entry on same symbol within cooldown window (Phase 4)
    if (this.settings.tradeCooldownMinutes > 0) {
      const cooldownMs = this.settings.tradeCooldownMinutes * 60 * 1000;
      const sinceTs = new Date(Date.now() - cooldownMs);
      const recentOrder = await prisma.order.findFirst({
        where: {
          userId,
          symbol: order.symbol,
          mode,
          status: 'FILLED',
          filledAt: { gte: sinceTs },
        },
        orderBy: { filledAt: 'desc' },
      });
      if (recentOrder) {
        const minsAgo = Math.round((Date.now() - (recentOrder.filledAt?.getTime() ?? 0)) / 60_000);
        return {
          passed: false,
          reason: `Trade cooldown active for ${order.symbol}: last trade ${minsAgo} min ago (cooldown: ${this.settings.tradeCooldownMinutes} min)`,
        };
      }
    }

    // 7. Risk per trade % of equity (Phase 4)
    // Only applies when stopLoss is provided (we need it to compute risk amount)
    if (this.settings.riskPerTradePct > 0 && order.stopLoss) {
      const qty = order.qty ?? 1;
      const riskAmount = qty * Math.abs(currentPrice - order.stopLoss);
      const maxRisk = accountEquity * this.settings.riskPerTradePct / 100;
      if (riskAmount > maxRisk) {
        return {
          passed: false,
          reason: `Risk per trade ₹${riskAmount.toFixed(2)} exceeds max ${this.settings.riskPerTradePct}% of equity ₹${maxRisk.toFixed(2)}`,
        };
      }
    }

    return { passed: true };
  }

  private async tripCircuitBreaker(pnl: number, equity: number): Promise<void> {
    if (this.circuitBreakerActive) return; // Already tripped

    this.circuitBreakerActive = true;
    log.error('CIRCUIT BREAKER TRIPPED', { pnl, equity });

    await prisma.setting.update({
      where: { key: 'circuit_breaker_active' },
      data: { value: 'true' },
    }).catch(() => void 0);

    await prisma.systemLog.create({
      data: {
        level: 'FATAL',
        category: 'RISK',
        message: 'Circuit breaker tripped — all trading halted',
        meta: { pnl, equity, timestamp: new Date().toISOString() },
      },
    }).catch(() => void 0);

    await telegramService.alert(
      '🔴 CIRCUIT BREAKER TRIPPED',
      `Daily P&L: ₹${pnl.toFixed(2)}\nAccount equity: ₹${equity.toFixed(2)}\nAll trading halted for this session.`,
    );
  }

  async resetCircuitBreaker(): Promise<void> {
    this.circuitBreakerActive = false;
    await prisma.setting.update({ where: { key: 'circuit_breaker_active' }, data: { value: 'false' } });
    log.info('Circuit breaker manually reset');
    await telegramService.notify('🟢 Circuit breaker has been manually reset — trading resumed.');
  }

  async setKillSwitch(active: boolean): Promise<void> {
    this.settings.killSwitchActive = active;
    await prisma.setting.upsert({
      where: { key: 'kill_switch_active' },
      update: { value: String(active) },
      create: { key: 'kill_switch_active', value: String(active), description: 'Emergency kill switch - blocks all orders' },
    });
    log.warn(`Kill switch ${active ? 'ACTIVATED' : 'deactivated'}`);
    if (active) {
      await telegramService.alert('🔴 KILL SWITCH ACTIVATED', 'All order placement is now blocked.');
    } else {
      await telegramService.notify('🟢 Kill switch deactivated — trading resumed.');
    }
  }

  isActive(): boolean {
    return this.circuitBreakerActive;
  }

  isKillSwitchActive(): boolean {
    return this.settings.killSwitchActive;
  }

  scheduleDailyReset(): void {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 30, 0); // 00:00:30
    const msToMidnight = nextMidnight.getTime() - now.getTime();

    setTimeout(() => {
      this.circuitBreakerActive = false;
      log.info('Daily risk counters reset at midnight');
      // Repeat every 24 hours
      setInterval(() => {
        this.circuitBreakerActive = false;
        log.info('Daily risk counters reset at midnight');
      }, 24 * 60 * 60 * 1000);
    }, msToMidnight);

    log.info(`Circuit breaker daily reset scheduled in ${Math.round(msToMidnight / 60000)} minutes`);
  }
}

export const riskManager = new RiskManager();
