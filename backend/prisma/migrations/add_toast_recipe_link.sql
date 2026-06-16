-- Sprint 3: link Toast menu items to Kyru recipes for COGS calculation.
ALTER TABLE toast_menu_items
  ADD COLUMN IF NOT EXISTS kyru_recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_toast_menu_items_kyru_recipe_id
  ON toast_menu_items(kyru_recipe_id);
