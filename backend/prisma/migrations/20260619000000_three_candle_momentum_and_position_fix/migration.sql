-- Migration: Three Candle Momentum strategy + Position unique constraint fix
-- Run via: psql $DATABASE_URL -f migration.sql
-- Or via Prisma when DB is reachable: npx prisma db push (from backend/ with .env present)

-- 1. Add THREE_CANDLE_MOMENTUM to StrategyType enum
--    ALTER TYPE ADD VALUE cannot run inside a transaction, so it must be
--    executed outside of a BEGIN/COMMIT block.
ALTER TYPE "StrategyType" ADD VALUE IF NOT EXISTS 'THREE_CANDLE_MOMENTUM';

-- 2. Drop the broken unique constraint that blocks closing a second trade
--    on the same symbol. Open-position uniqueness is now enforced by the
--    partial index below, which only applies to is_open = TRUE rows.
--    (Prisma 5.x maps @@unique([symbol, mode, isOpen]) to this index name.)
DROP INDEX IF EXISTS "positions_symbol_mode_open_key";

-- 3. Partial unique index: at most one OPEN position per (symbol, mode).
--    Closed positions (is_open = FALSE / deleted by app code) are not
--    constrained, so unlimited trades can be closed for the same symbol.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_open_position_per_symbol_mode"
  ON "positions" ("symbol", "mode")
  WHERE "is_open" = TRUE;
