-- Add suspension fields to restaurants
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS suspended    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMPTZ;
