-- Add unitCost to stock_logs for stable historical COGS snapshots.
-- Null on all existing records (legacy). New logs populate it from Product.costPerUnit
-- at the time the transaction is created.
ALTER TABLE "stock_logs"
  ADD COLUMN IF NOT EXISTS "unitCost" DOUBLE PRECISION;
