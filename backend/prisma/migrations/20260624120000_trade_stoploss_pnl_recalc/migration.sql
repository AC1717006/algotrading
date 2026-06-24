-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add stop_loss + target to trades; fix PnL sign inversion
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add stop_loss and target columns to trades table (additive, no data loss)
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "stop_loss" DOUBLE PRECISION;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "target" DOUBLE PRECISION;

-- 2. Fix sign-inverted PnL in all closed trades.
--
--    Root cause: a previous version of closePosition/autoExit used
--    (entryPrice - exitPrice) for LONG closes — the SHORT formula — producing
--    negative PnL on profitable BUY trades and vice versa.
--
--    Correct formulas:
--      SELL trade (closing LONG): pnl = (exitPrice - entryPrice) * qty - totalCharges
--      BUY  trade (closing SHORT): pnl = (entryPrice - exitPrice) * qty - totalCharges
--
--    The 'charges' column stores exit-leg charges only (exitPrice * qty * 0.0003).
--    Entry-leg charges = entryPrice * qty * 0.0003 must be re-added.
--
--    We recalculate every closed trade uniformly so DB is self-consistent.

UPDATE "trades"
SET "pnl" = CASE
  WHEN "side" = 'SELL' THEN
    ("exit_price" - "entry_price") * "qty"
    - "charges"
    - ("entry_price" * "qty" * 0.0003)
  WHEN "side" = 'BUY' THEN
    ("entry_price" - "exit_price") * "qty"
    - "charges"
    - ("entry_price" * "qty" * 0.0003)
  ELSE "pnl"
END
WHERE "exit_price" IS NOT NULL;

-- 3. Recompute strategy aggregate stats from corrected trade data.
--    Only updates strategies that have at least one linked closed trade.

UPDATE "strategies"
SET
  "total_pnl"    = sq.total_pnl,
  "wins"         = sq.wins,
  "losses"       = sq.losses,
  "total_trades" = sq.total_trades
FROM (
  SELECT
    o.strategy_id,
    COALESCE(SUM(t.pnl), 0)                              AS total_pnl,
    COUNT(CASE WHEN t.pnl > 0  THEN 1 END)               AS wins,
    COUNT(CASE WHEN t.pnl <= 0 THEN 1 END)               AS losses,
    COUNT(t.id)                                           AS total_trades
  FROM "trades" t
  JOIN "orders" o ON o.id = t.order_id
  WHERE t.exit_price IS NOT NULL
    AND o.strategy_id IS NOT NULL
  GROUP BY o.strategy_id
) sq
WHERE "strategies"."id" = sq.strategy_id;
