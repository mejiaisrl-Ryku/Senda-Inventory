-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_preparation_stock_logs
--
-- Adds a PRODUCED stock reason and a preparation-side mirror of stock_logs,
-- so producing a preparation batch (consuming its ingredients) and producing
-- a recipe batch (consuming its ingredients + linked preparation stock) both
-- have an auditable log, same as product stock changes.
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "StockReason" ADD VALUE IF NOT EXISTS 'PRODUCED';

CREATE TABLE preparation_stock_logs (
  id                 TEXT PRIMARY KEY,
  preparation_id     INTEGER NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
  previous_quantity  DOUBLE PRECISION NOT NULL,
  new_quantity       DOUBLE PRECISION NOT NULL,
  change             DOUBLE PRECISION NOT NULL,
  reason             "StockReason" NOT NULL,
  timestamp          TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id            TEXT NOT NULL REFERENCES users(id),
  notes              TEXT
);

CREATE INDEX preparation_stock_logs_preparation_id_idx ON preparation_stock_logs(preparation_id);
CREATE INDEX preparation_stock_logs_user_id_idx ON preparation_stock_logs(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Same join-to-parent pattern as preparation_ingredients: no restaurant_id of
-- its own, isolation goes through preparations.

ALTER TABLE preparation_stock_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparation_stock_logs FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON preparation_stock_logs TO senda_app, senda_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senda_app, senda_admin;

CREATE POLICY tenant_isolation ON preparation_stock_logs
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_stock_logs.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_stock_logs.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  );
