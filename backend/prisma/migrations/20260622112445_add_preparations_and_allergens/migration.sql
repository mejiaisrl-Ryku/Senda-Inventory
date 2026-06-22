-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_preparations_and_allergens
--
-- Adds the prep layer (mise en place) and allergen tracking for recipes.
-- All new columns on recipes are nullable; existing recipes are unaffected.
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ────────────────────────────────────────────────────────────────

CREATE TYPE conservation_type AS ENUM ('REFRIGERADO', 'CONGELADO', 'AMBIENTE');
CREATE TYPE recipe_category   AS ENUM ('STARTER', 'MAIN', 'DESSERT', 'SNACK', 'BEVERAGE');
CREATE TYPE kitchen_station   AS ENUM ('GRILL', 'SAUCIER', 'PANTRY', 'PASTRY', 'BAR', 'FRYER');

-- ── 2. New tables ─────────────────────────────────────────────────────────────

CREATE TABLE preparations (
  id                          SERIAL PRIMARY KEY,
  restaurant_id               TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name                        VARCHAR(255) NOT NULL,
  description                 TEXT,
  preparation_method          TEXT,
  plating_notes               TEXT,
  photo_url                   VARCHAR(512),
  shelf_life_days             INTEGER,
  storage_temp                VARCHAR(50),
  conservation_type           conservation_type,
  almacen                     VARCHAR(100),
  recipe_yield                DECIMAL(10, 2),
  recipe_yield_unit           VARCHAR(20),
  cost                        DECIMAL(10, 4) NOT NULL DEFAULT 0,
  cost_per_portion_estimate   DECIMAL(10, 4),
  created_by                  TEXT REFERENCES users(id),
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX preparations_restaurant_id_idx ON preparations(restaurant_id);

CREATE TABLE recipe_preparations (
  id              SERIAL PRIMARY KEY,
  recipe_id       TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  preparation_id  INTEGER NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
  quantity        DECIMAL(10, 4),
  unit            VARCHAR(20),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(recipe_id, preparation_id)
);

CREATE INDEX recipe_preparations_recipe_id_idx ON recipe_preparations(recipe_id);
CREATE INDEX recipe_preparations_preparation_id_idx ON recipe_preparations(preparation_id);

CREATE TABLE allergens (
  id        SERIAL PRIMARY KEY,
  code      VARCHAR(50) UNIQUE NOT NULL,
  label_en  VARCHAR(100) NOT NULL,
  label_es  VARCHAR(100) NOT NULL
);

CREATE TABLE recipe_allergens (
  id                    SERIAL PRIMARY KEY,
  recipe_id             TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  allergen_id           INTEGER NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  is_present            BOOLEAN NOT NULL DEFAULT true,
  manually_overridden   BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(recipe_id, allergen_id)
);

CREATE INDEX recipe_allergens_recipe_id_idx ON recipe_allergens(recipe_id);
CREATE INDEX recipe_allergens_allergen_id_idx ON recipe_allergens(allergen_id);

-- ── 3. New columns on recipes (all nullable, backwards compatible) ───────────

ALTER TABLE recipes
  ADD COLUMN portions               INTEGER,
  ADD COLUMN batch_weight           DECIMAL(10, 2),
  ADD COLUMN preparation_method     TEXT,
  ADD COLUMN plating_notes          TEXT,
  ADD COLUMN photo_url              VARCHAR(512),
  ADD COLUMN yield_percent          DECIMAL(5, 2),
  ADD COLUMN category               recipe_category,
  ADD COLUMN station                kitchen_station;

-- ── 4. Seed allergens (14 major allergens, EN/ES labels) ─────────────────────

INSERT INTO allergens (code, label_en, label_es) VALUES
  ('gluten',     'Gluten',     'Gluten'),
  ('dairy',      'Dairy',      'Lácteos'),
  ('eggs',       'Eggs',       'Huevos'),
  ('peanuts',    'Peanuts',    'Cacahuetes'),
  ('tree_nuts',  'Tree Nuts',  'Frutos Secos'),
  ('shellfish',  'Shellfish',  'Moluscos'),
  ('fish',       'Fish',       'Pescado'),
  ('sesame',     'Sesame',     'Sésamo'),
  ('soy',        'Soy',        'Soja'),
  ('mustard',    'Mustard',    'Mostaza'),
  ('celery',     'Celery',     'Apio'),
  ('sulfites',   'Sulfites',   'Sulfitos'),
  ('lupin',      'Lupin',      'Altramuz'),
  ('mollusks',   'Mollusks',   'Cefalópodos')
ON CONFLICT (code) DO NOTHING;

-- ── 5. Row-Level Security ─────────────────────────────────────────────────────
-- Matches the pattern in 20260608130000_enable_rls_tenant_isolation:
-- senda_app (prismaT) is RLS-enforced; senda_admin (prismaAdmin) bypasses.

ALTER TABLE preparations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparations        FORCE  ROW LEVEL SECURITY;

ALTER TABLE recipe_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_preparations FORCE  ROW LEVEL SECURITY;

ALTER TABLE allergens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergens           FORCE  ROW LEVEL SECURITY;

ALTER TABLE recipe_allergens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_allergens    FORCE  ROW LEVEL SECURITY;

-- Grants (new tables aren't covered by the ALTER DEFAULT PRIVILEGES set up
-- in the original RLS migration if that ran before senda_app/senda_admin
-- existed in this session; safe to re-grant explicitly here)
GRANT SELECT, INSERT, UPDATE, DELETE ON preparations, recipe_preparations, allergens, recipe_allergens
  TO senda_app, senda_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senda_app, senda_admin;

-- preparations — restaurant-scoped
CREATE POLICY tenant_isolation ON preparations
  AS PERMISSIVE FOR ALL
  USING     (restaurant_id = current_setting('app.restaurant_id', true))
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id', true));

-- recipe_preparations — join to recipes
CREATE POLICY tenant_isolation ON recipe_preparations
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_preparations.recipe_id
        AND  r.restaurant_id = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_preparations.recipe_id
        AND  r.restaurant_id = current_setting('app.restaurant_id', true)
    )
  );

-- recipe_allergens — join to recipes
CREATE POLICY tenant_isolation ON recipe_allergens
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_allergens.recipe_id
        AND  r.restaurant_id = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_allergens.recipe_id
        AND  r.restaurant_id = current_setting('app.restaurant_id', true)
    )
  );

-- allergens — read-only lookup table, visible to all tenants
CREATE POLICY read_all ON allergens
  AS PERMISSIVE FOR SELECT
  USING (true);

-- ── 6. Indexes to support policy lookups ──────────────────────────────────────
-- recipe_preparations.recipe_id and recipe_allergens.recipe_id are already
-- indexed above (section 2). recipes.id is the PK on the referenced side.
