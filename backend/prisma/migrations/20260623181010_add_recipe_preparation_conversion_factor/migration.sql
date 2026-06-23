-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_recipe_preparation_conversion_factor
--
-- recipe_preparations already had quantity/unit columns but the cost formula
-- never used them — every linked preparation contributed its full cost
-- regardless of how much a recipe actually used. This adds conversionFactor
-- so usage can be costed the same way ingredients are (auto-convert when
-- units match a known pair, else a manual factor), and the cost formula is
-- updated in application code to match.
--
-- Run via DIRECT_URL (postgres superuser), never through the pooler.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE recipe_preparations ADD COLUMN conversion_factor DOUBLE PRECISION;
