-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_preparation_ingredients_and_stock
--
-- Lets a preparation carry its own ingredient list (mirrors recipe_ingredients)
-- so its cost can be computed live from linked products, and adds a
-- current_stock counter on preparations for manual stock adjustments.
-- All additive; existing preparations are unaffected (current_stock defaults
-- to 0, no ingredients rows created).
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE preparations ADD COLUMN current_stock DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE preparation_ingredients (
  id                 TEXT PRIMARY KEY,
  preparation_id     INTEGER NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity           DECIMAL(12, 3) NOT NULL,
  unit               TEXT NOT NULL,
  conversion_factor  DOUBLE PRECISION
);

CREATE INDEX preparation_ingredients_preparation_id_idx ON preparation_ingredients(preparation_id);
CREATE INDEX preparation_ingredients_product_id_idx ON preparation_ingredients(product_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Same join-to-parent pattern as recipe_ingredients: preparation_ingredients
-- has no restaurant_id of its own, so isolation goes through preparations.

ALTER TABLE preparation_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparation_ingredients FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON preparation_ingredients TO senda_app, senda_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senda_app, senda_admin;

CREATE POLICY tenant_isolation ON preparation_ingredients
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_ingredients.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_ingredients.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  );
