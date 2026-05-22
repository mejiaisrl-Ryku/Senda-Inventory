-- Migration: add EVENTS + DELIVERY to SalesCategory, create labor_entries table
-- Run against your Railway Postgres DB via the Railway console or psql.

-- 1. Extend SalesCategory enum
ALTER TYPE "SalesCategory" ADD VALUE IF NOT EXISTS 'EVENTS';
ALTER TYPE "SalesCategory" ADD VALUE IF NOT EXISTS 'DELIVERY';

-- 2. Create labor_entries table
CREATE TABLE IF NOT EXISTS "labor_entries" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "date"         DATE NOT NULL,
  "fohLabor"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bohLabor"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "management"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "labor_entries_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS "labor_entries_restaurantId_idx"
  ON "labor_entries"("restaurantId");

CREATE INDEX IF NOT EXISTS "labor_entries_restaurantId_date_idx"
  ON "labor_entries"("restaurantId", "date");

-- 4. Foreign key to restaurants
ALTER TABLE "labor_entries"
  ADD CONSTRAINT "labor_entries_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
