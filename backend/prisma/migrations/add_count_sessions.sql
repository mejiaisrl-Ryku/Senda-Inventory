-- ── Inventory count session migrations ────────────────────────────────────────

-- Enums
CREATE TYPE "CountDepartment" AS ENUM ('KITCHEN', 'BAR', 'FOH', 'ALL');
CREATE TYPE "CountStatus"     AS ENUM ('OPEN', 'CLOSED');

-- Count sessions
CREATE TABLE IF NOT EXISTS "count_sessions" (
  "id"           TEXT        NOT NULL,
  "restaurantId" TEXT        NOT NULL,
  "date"         DATE        NOT NULL,
  "department"   "CountDepartment" NOT NULL DEFAULT 'ALL',
  "status"       "CountStatus"     NOT NULL DEFAULT 'OPEN',
  "createdBy"    TEXT        NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "count_sessions_pkey" PRIMARY KEY ("id")
);

-- Count entries (one row per product per session)
CREATE TABLE IF NOT EXISTS "count_entries" (
  "id"               TEXT           NOT NULL,
  "sessionId"        TEXT           NOT NULL,
  "productId"        TEXT           NOT NULL,
  "expectedQuantity" DECIMAL(12, 3) NOT NULL DEFAULT 0,
  "actualQuantity"   DECIMAL(12, 3) NOT NULL DEFAULT 0,
  "variance"         DECIMAL(12, 3) NOT NULL DEFAULT 0,
  "unitCost"         DECIMAL(12, 4) NOT NULL DEFAULT 0,
  "varianceValue"    DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "count_entries_pkey" PRIMARY KEY ("id")
);

-- Unique: one entry per product per session
CREATE UNIQUE INDEX IF NOT EXISTS "count_entries_sessionId_productId_key"
  ON "count_entries"("sessionId", "productId");

-- Indexes
CREATE INDEX IF NOT EXISTS "count_sessions_restaurantId_idx"
  ON "count_sessions"("restaurantId");
CREATE INDEX IF NOT EXISTS "count_sessions_restaurantId_date_idx"
  ON "count_sessions"("restaurantId", "date");
CREATE INDEX IF NOT EXISTS "count_entries_sessionId_idx"
  ON "count_entries"("sessionId");
CREATE INDEX IF NOT EXISTS "count_entries_productId_idx"
  ON "count_entries"("productId");

-- Foreign keys
ALTER TABLE "count_sessions"
  ADD CONSTRAINT "count_sessions_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "count_entries"
  ADD CONSTRAINT "count_entries_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "count_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "count_entries"
  ADD CONSTRAINT "count_entries_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Auto-update updatedAt trigger for count_sessions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER count_sessions_updated_at
  BEFORE UPDATE ON "count_sessions"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
