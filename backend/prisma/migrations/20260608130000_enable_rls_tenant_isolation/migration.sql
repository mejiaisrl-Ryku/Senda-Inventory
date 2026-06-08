-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: enable_rls_tenant_isolation
--
-- Purpose: Add PostgreSQL Row-Level Security as a database-enforced backstop
--          beneath the app-level Prisma WHERE-injection layer.
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
--
-- Rollback: see docs/runbook-rollback.md § "RLS rollback"
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Application roles ──────────────────────────────────────────────────────
--
-- senda_app   : used by normal request traffic (prismaT).
--               No BYPASSRLS — RLS policies are enforced.
--
-- senda_admin : used by KYRU_MANAGER cross-tenant reads (prismaAdmin).
--               BYPASSRLS — policies are skipped so platform admins see
--               all tenants.  This role must NEVER be used in normal
--               request handlers.
--
-- Passwords are injected at deploy time via Railway env vars:
--   APP_DB_PASSWORD   → senda_app password
--   ADMIN_DB_PASSWORD → senda_admin password
-- The CREATE ROLE statements below use placeholder literals; the post-deploy
-- script (docs/runbook-rls-deploy.md) runs ALTER ROLE … PASSWORD '…'
-- using Railway-injected secrets so passwords are never in source control.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_app') THEN
    CREATE ROLE senda_app
      LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      PASSWORD 'PLACEHOLDER_CHANGE_BEFORE_DEPLOY';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_admin') THEN
    CREATE ROLE senda_admin
      LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
      PASSWORD 'PLACEHOLDER_CHANGE_BEFORE_DEPLOY';
  END IF;
END $$;

-- ── 2. Grants ─────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO senda_app, senda_admin;

-- Tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO senda_app, senda_admin;

-- Sequences (needed for cuid / serial default columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO senda_app, senda_admin;

-- Future tables created by migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO senda_app, senda_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO senda_app, senda_admin;

-- ── 3. Enable RLS on every tenant-owned table ─────────────────────────────────
--
-- FORCE ROW LEVEL SECURITY makes the policies apply even to the table owner
-- (postgres).  Combined with the fact that normal traffic connects as
-- senda_app (non-superuser), this gives two enforcement layers.
--
-- NOTE: superusers (postgres) still bypass RLS regardless of FORCE RLS.
-- The postgres connection is restricted to migrations / emergency access only.
-- ─────────────────────────────────────────────────────────────────────────────

-- Restaurant-scoped tables ───────────────────────────────────────────────────

ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         FORCE  ROW LEVEL SECURITY;

ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           FORCE  ROW LEVEL SECURITY;

ALTER TABLE sales_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_entries    FORCE  ROW LEVEL SECURITY;

ALTER TABLE labor_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_entries    FORCE  ROW LEVEL SECURITY;

ALTER TABLE count_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_sessions   FORCE  ROW LEVEL SECURITY;

ALTER TABLE recipes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes          FORCE  ROW LEVEL SECURITY;

ALTER TABLE location_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_budgets FORCE  ROW LEVEL SECURITY;

-- Owner-scoped tables ────────────────────────────────────────────────────────

ALTER TABLE cogs_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cogs_categories  FORCE  ROW LEVEL SECURITY;

-- Child tables (no direct tenant column — policy joins to parent) ─────────────

ALTER TABLE stock_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_logs          FORCE  ROW LEVEL SECURITY;

ALTER TABLE count_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_entries       FORCE  ROW LEVEL SECURITY;

ALTER TABLE order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items         FORCE  ROW LEVEL SECURITY;

ALTER TABLE recipe_ingredients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients  FORCE  ROW LEVEL SECURITY;

-- ── 4. RLS policies ───────────────────────────────────────────────────────────
--
-- Fail-closed design:
--   current_setting('app.restaurant_id', true) returns NULL when the GUC is
--   not set (missing_ok = true).  NULL = 'x' evaluates to NULL (not true),
--   so rows are not visible → zero rows returned when no context is set.
--
-- USING clause   : governs SELECT, UPDATE, DELETE row visibility.
-- WITH CHECK     : governs INSERT, UPDATE values written.
-- Both must pass for a write to succeed.
-- ─────────────────────────────────────────────────────────────────────────────

-- products ────────────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON products
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- orders ──────────────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON orders
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- sales_entries ───────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON sales_entries
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- labor_entries ───────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON labor_entries
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- count_sessions ──────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON count_sessions
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- recipes ─────────────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON recipes
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- location_budgets (has both restaurantId and ownerAccountId — scoped by restaurantId) ──
CREATE POLICY tenant_isolation ON location_budgets
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- cogs_categories (owner-scoped) ──────────────────────────────────────────────
CREATE POLICY tenant_isolation ON cogs_categories
  AS PERMISSIVE FOR ALL
  USING     ("ownerAccountId" = current_setting('app.owner_account_id', true))
  WITH CHECK ("ownerAccountId" = current_setting('app.owner_account_id', true));

-- stock_logs — join to products ───────────────────────────────────────────────
-- Note: the EXISTS sub-query adds ~1 ms per query. Acceptable for a backstop.
CREATE POLICY tenant_isolation ON stock_logs
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE  p.id = stock_logs."productId"
        AND  p."restaurantId" = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE  p.id = stock_logs."productId"
        AND  p."restaurantId" = current_setting('app.restaurant_id', true)
    )
  );

-- count_entries — join to count_sessions ──────────────────────────────────────
CREATE POLICY tenant_isolation ON count_entries
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM count_sessions cs
      WHERE  cs.id = count_entries."sessionId"
        AND  cs."restaurantId" = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM count_sessions cs
      WHERE  cs.id = count_entries."sessionId"
        AND  cs."restaurantId" = current_setting('app.restaurant_id', true)
    )
  );

-- order_items — join to orders ────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON order_items
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE  o.id = order_items."orderId"
        AND  o."restaurantId" = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE  o.id = order_items."orderId"
        AND  o."restaurantId" = current_setting('app.restaurant_id', true)
    )
  );

-- recipe_ingredients — join to recipes ────────────────────────────────────────
CREATE POLICY tenant_isolation ON recipe_ingredients
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_ingredients."recipeId"
        AND  r."restaurantId" = current_setting('app.restaurant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE  r.id = recipe_ingredients."recipeId"
        AND  r."restaurantId" = current_setting('app.restaurant_id', true)
    )
  );

-- ── 5. Indexes to support policy lookups ──────────────────────────────────────
-- The join-based policies above do an EXISTS against the parent table.
-- The relevant parent FKs are already indexed (from baseline migration), but
-- confirm the child FK columns are indexed.

-- stock_logs.productId — already exists in baseline:
--   CREATE INDEX "stock_logs_productId_idx" ON stock_logs("productId" ASC)
-- count_entries.sessionId — already exists
-- order_items.orderId — already exists
-- recipe_ingredients.recipeId — already exists

-- No new indexes needed; existing FK indexes are sufficient.
