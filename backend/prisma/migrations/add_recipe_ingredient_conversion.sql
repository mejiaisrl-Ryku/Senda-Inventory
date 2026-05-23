-- Add conversionFactor to recipe_ingredients (recipe units per purchase unit)
ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS "conversionFactor" DOUBLE PRECISION;
