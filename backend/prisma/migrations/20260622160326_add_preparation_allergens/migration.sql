-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_preparation_allergens
--
-- Lets a preparation carry its own allergens, so linking a prep to a recipe
-- can cascade those allergens onto the recipe. All additive; existing
-- preparations/recipes are unaffected.
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE preparation_allergens (
  id              SERIAL PRIMARY KEY,
  preparation_id  INTEGER NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
  allergen_id     INTEGER NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(preparation_id, allergen_id)
);

CREATE INDEX preparation_allergens_preparation_id_idx ON preparation_allergens(preparation_id);
CREATE INDEX preparation_allergens_allergen_id_idx ON preparation_allergens(allergen_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Matches the pattern used for recipe_preparations / recipe_allergens:
-- isolate via a join to the parent's restaurant_id, ENABLE + FORCE, with
-- explicit grants since this table is new.

ALTER TABLE preparation_allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparation_allergens FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON preparation_allergens TO senda_app, senda_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senda_app, senda_admin;

CREATE POLICY tenant_isolation ON preparation_allergens
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_allergens.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM preparations p
      WHERE  p.id = preparation_allergens.preparation_id
        AND  p.restaurant_id = current_setting('app.restaurant_id', true)
    )
  );
