-- ── Recipe Costing ────────────────────────────────────────────────────────────
-- Run manually via psql or Railway console after deploying schema changes.

-- 1. RecipeDepartment enum
CREATE TYPE "RecipeDepartment" AS ENUM ('KITCHEN', 'BAR');

-- 2. recipes table
CREATE TABLE IF NOT EXISTS "recipes" (
  "id"           TEXT             NOT NULL DEFAULT gen_random_uuid()::text,
  "restaurantId" TEXT             NOT NULL,
  "name"         TEXT             NOT NULL,
  "department"   "RecipeDepartment" NOT NULL,
  "sellingPrice" DECIMAL(10, 2)   NOT NULL,
  "createdAt"    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipes_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "recipes_restaurantId_idx" ON "recipes"("restaurantId");

-- 3. recipe_ingredients table
CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
  "id"        TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "recipeId"  TEXT           NOT NULL,
  "productId" TEXT           NOT NULL,
  "quantity"  DECIMAL(12, 3) NOT NULL,
  "unit"      TEXT           NOT NULL,

  CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipe_ingredients_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE,
  CONSTRAINT "recipe_ingredients_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipeId_idx"  ON "recipe_ingredients"("recipeId");
CREATE INDEX IF NOT EXISTS "recipe_ingredients_productId_idx" ON "recipe_ingredients"("productId");

-- 4. updatedAt auto-update trigger (reuse function if it already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "recipes_updated_at" ON "recipes";
CREATE TRIGGER "recipes_updated_at"
  BEFORE UPDATE ON "recipes"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
