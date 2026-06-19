import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import brokerRoutes from '../modules/broker/broker.routes';
import tradingRoutes from '../modules/trading/trading.routes';
import strategyRoutes from '../modules/strategies/strategy.routes';
import marketDataRoutes from '../modules/market-data/market-data.routes';
import settingsRoutes from '../modules/settings/settings.routes';
import logsRoutes from '../modules/logs/logs.routes';
import s3Routes from '../modules/s3/s3.routes';
import systemRoutes from '../modules/system/system.routes';
import healthRoutes from '../modules/health/health.routes';
import backtestRoutes from '../modules/backtest/backtest.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/broker', brokerRoutes);
router.use('/trading', tradingRoutes);
router.use('/strategies', strategyRoutes);
router.use('/market', marketDataRoutes);
router.use('/settings', settingsRoutes);
router.use('/logs', logsRoutes);
router.use('/s3', s3Routes);
router.use('/system', systemRoutes);
router.use('/health', healthRoutes);
router.use('/backtest', backtestRoutes);

// Quick liveness ping (no DB check)
router.get('/ping', (_req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

export default router;
