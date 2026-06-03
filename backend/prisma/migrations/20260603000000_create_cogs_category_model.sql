-- Migration: replace COGSCategory enum with owner-scoped cogs_categories table
-- Run via: railway run psql $DATABASE_URL -f prisma/migrations/20260603000000_create_cogs_category_model.sql
--
-- What this does:
--   1. Creates cogs_categories table (PK, ownerAccountId FK, unique name-per-owner)
--   2. Seeds 5 default categories for every existing OwnerAccount
--   3. Adds cogsCategoryId FK to products, migrates existing enum values
--   4. Drops old products.cogsCategory enum column
--   5. Adds cogsCategoryId FK to order_items (no old data to migrate)
--   6. Drops the COGSCategory enum type

BEGIN;

-- ── 1. Create cogs_categories table ──────────────────────────────────────────

CREATE TABLE "cogs_categories" (
  "id"             TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "ownerAccountId" TEXT         NOT NULL,
  "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "cogs_categories_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "cogs_categories_ownerAccountId_name_key"
    UNIQUE ("ownerAccountId", "name"),

  CONSTRAINT "cogs_categories_ownerAccountId_fkey"
    FOREIGN KEY ("ownerAccountId")
    REFERENCES "owner_accounts"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "cogs_categories_ownerAccountId_idx"
  ON "cogs_categories"("ownerAccountId");

-- ── 2. Seed default categories for every existing owner ───────────────────────
-- Names match the old COGSCategory enum strings exactly so the reports controller
-- (which keys buckets by cogsCategory.name) keeps working without a code change.

INSERT INTO "cogs_categories" ("id", "name", "ownerAccountId", "updatedAt")
SELECT
  gen_random_uuid()::TEXT,
  cat.name,
  oa."id",
  NOW()
FROM "owner_accounts" oa
CROSS JOIN (
  VALUES ('BEER'), ('LIQUOR'), ('WINE'), ('FOOD'), ('NON_ALCOHOLIC')
) AS cat(name)
ON CONFLICT ("ownerAccountId", "name") DO NOTHING;

-- ── 3. Add cogsCategoryId FK column to products ────────────────────────────────

ALTER TABLE "products"
  ADD COLUMN "cogsCategoryId" TEXT;

-- Migrate existing enum values → new FK.
-- Cast via pg_enum name to avoid implicit ::text ambiguity with the enum type.
UPDATE "products" p
SET    "cogsCategoryId" = cc."id"
FROM   "cogs_categories" cc
JOIN   "restaurants"     r  ON r."id" = p."restaurantId"
WHERE  r."ownerAccountId"   = cc."ownerAccountId"
  AND  cc."name"             = p."cogsCategory"::VARCHAR
  AND  p."cogsCategory"     IS NOT NULL;

-- ── 4. Drop old enum column, add FK constraint and index ──────────────────────

ALTER TABLE "products"
  DROP COLUMN "cogsCategory";

ALTER TABLE "products"
  ADD CONSTRAINT "products_cogsCategoryId_fkey"
    FOREIGN KEY ("cogsCategoryId")
    REFERENCES "cogs_categories"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "products_cogsCategoryId_idx"
  ON "products"("cogsCategoryId");

-- ── 5. Add cogsCategoryId FK column to order_items ───────────────────────────
-- No old data to migrate — OrderItem never had a cogsCategory column.

ALTER TABLE "order_items"
  ADD COLUMN "cogsCategoryId" TEXT;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_cogsCategoryId_fkey"
    FOREIGN KEY ("cogsCategoryId")
    REFERENCES "cogs_categories"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "order_items_cogsCategoryId_idx"
  ON "order_items"("cogsCategoryId");

-- ── 6. Drop the old COGSCategory enum type ────────────────────────────────────
-- Safe now — no column references it after step 4.

DROP TYPE IF EXISTS "COGSCategory";

COMMIT;
