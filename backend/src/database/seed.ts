import { PrismaClient, UserRole, StrategyType, TradingMode } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from '../config';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱  Seeding database...');

  // ─── Admin user ─────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: config.ADMIN_EMAIL },
    update: {},
    create: { email: config.ADMIN_EMAIL, password: passwordHash, role: UserRole.ADMIN },
  });
  console.log('✅  Admin user:', admin.email);

  // ─── Default settings ────────────────────────────────────────────────────────
  const defaults: Array<{ key: string; value: string; description: string }> = [
    { key: 'trading_mode',              value: 'PAPER',       description: 'Current trading mode (PAPER | LIVE)' },
    { key: 'paper_balance',             value: String(config.PAPER_TRADING_INITIAL_BALANCE), description: 'Paper trading virtual balance in INR' },
    { key: 'max_daily_loss_pct',        value: String(config.MAX_DAILY_LOSS_PERCENT),        description: 'Maximum daily loss % before halt' },
    { key: 'max_trades_per_day',        value: String(config.MAX_TRADES_PER_DAY),            description: 'Maximum number of orders per day' },
    { key: 'max_position_size_pct',     value: String(config.MAX_POSITION_SIZE_PERCENT),     description: 'Maximum position size as % of equity' },
    { key: 'circuit_breaker_loss_pct',  value: String(config.CIRCUIT_BREAKER_LOSS_PERCENT),  description: 'Total loss % that triggers circuit breaker' },
    { key: 'circuit_breaker_active',    value: 'false',       description: 'Whether circuit breaker is currently active' },
    { key: 'telegram_alerts',           value: 'true',        description: 'Enable Telegram alert notifications' },
    { key: 'upstox_token_valid',        value: 'false',       description: 'Whether the current Upstox access token is valid' },
    { key: 'default_qty',               value: '1',           description: 'Default quantity per trade when not specified' },
    { key: 'max_trades_day',            value: String(config.MAX_TRADES_PER_DAY), description: 'Maximum number of trades per day' },
    { key: 'max_loss_day',              value: '5000',        description: 'Maximum loss per day in Rs' },
    { key: 'per_trade_loss_pct',        value: '1',           description: 'Per trade max loss % (stop-loss sizing)' },
    { key: 'strategies_enabled',        value: 'true',        description: 'Master switch — enable/disable all strategies' },
  ];

  for (const s of defaults) {
    await prisma.setting.upsert({ where: { key: s.key }, update: {}, create: s });
  }
  console.log('✅  Default settings seeded');

  // ─── Sample strategies ───────────────────────────────────────────────────────
  const strategies = [
    {
      id: 'strategy-ema-crossover',
      name: 'EMA 9/21 Crossover',
      type: StrategyType.EMA_CROSSOVER,
      symbol: 'NSE_EQ|INE009A01021',
      exchange: 'NSE',
      timeframe: '5minute',
      parameters: { fastPeriod: 9, slowPeriod: 21 },
      riskConfig: { stopLossPercent: 1.5, targetPercent: 3.0, maxPositionValue: 50000, trailingStop: false },
      mode: TradingMode.PAPER,
    },
    {
      id: 'strategy-rsi',
      name: 'RSI 14 Mean Reversion',
      type: StrategyType.RSI,
      symbol: 'NSE_EQ|INE040A01034',
      exchange: 'NSE',
      timeframe: '15minute',
      parameters: { period: 14, oversold: 30, overbought: 70 },
      riskConfig: { stopLossPercent: 1.0, targetPercent: 2.0, maxPositionValue: 30000, trailingStop: false },
      mode: TradingMode.PAPER,
    },
    {
      id: 'strategy-macd',
      name: 'MACD Zero-Line Cross',
      type: StrategyType.MACD,
      symbol: 'NSE_EQ|INE009A01021',
      exchange: 'NSE',
      timeframe: '15minute',
      parameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      riskConfig: { stopLossPercent: 1.5, targetPercent: 3.0, maxPositionValue: 50000, trailingStop: false },
      mode: TradingMode.PAPER,
    },
  ];

  for (const s of strategies) {
    await prisma.strategy.upsert({
      where: { id: s.id },
      update: {},
      create: s,
    });
  }
  console.log('✅  Sample strategies seeded');

  console.log('\n🎉  Database seeded successfully!');
  console.log(`\n   Login: ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
