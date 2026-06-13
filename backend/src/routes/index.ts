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

router.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

export default router;
