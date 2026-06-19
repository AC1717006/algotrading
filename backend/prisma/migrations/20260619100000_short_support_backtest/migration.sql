-- AddColumn: side to positions (SHORT support)
-- OrderSide enum already exists in the DB (used by orders and trades)
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "side" "OrderSide" NOT NULL DEFAULT 'BUY';

-- Create Backtest table
CREATE TABLE IF NOT EXISTS "backtests" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "strategy_type" TEXT        NOT NULL,
  "symbol"        TEXT        NOT NULL,
  "exchange"      TEXT        NOT NULL DEFAULT 'NSE',
  "from_date"     TIMESTAMPTZ NOT NULL,
  "to_date"       TIMESTAMPTZ NOT NULL,
  "capital"       FLOAT8      NOT NULL,
  "parameters"    JSONB       NOT NULL,
  "result"        JSONB       NOT NULL,
  "metrics"       JSONB       NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "backtests_strategy_type_idx" ON "backtests"("strategy_type");
CREATE INDEX IF NOT EXISTS "backtests_symbol_idx"        ON "backtests"("symbol");
CREATE INDEX IF NOT EXISTS "backtests_created_at_idx"    ON "backtests"("created_at");

-- Risk manager new settings (upsert so existing data is preserved)
INSERT INTO "settings" ("id", "key", "value", "description") VALUES
  (gen_random_uuid(), 'max_open_positions',    '3',     'Maximum concurrent open positions'),
  (gen_random_uuid(), 'trade_cooldown_minutes','15',    'Cooldown in minutes between trades on same symbol'),
  (gen_random_uuid(), 'risk_per_trade_pct',    '1',     'Maximum risk per trade as % of equity'),
  (gen_random_uuid(), 'kill_switch_active',    'false', 'Emergency kill switch - blocks all orders')
ON CONFLICT ("key") DO NOTHING;
