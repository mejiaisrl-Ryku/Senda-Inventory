-- Migration: Add OwnerAccount model, replace groupId with ownerAccountId
--
-- Apply via Railway DB console:
--   railway connect postgres  →  \i prisma/migrations/add_owner_accounts.sql
-- OR paste directly into the Railway Postgres query interface.
--
-- This migration is idempotent (uses IF NOT EXISTS / IF EXISTS guards).
-- The schema.prisma change will also be applied automatically on next
-- Railway deploy via `prisma db push`.

-- ── 1. New Role enum values ────────────────────────────────────────────────────
--    KYRU_MANAGER replaces SUPER_ADMIN for Kyru-internal admins.
--    OWNER_SUPER_ADMIN is the new cross-location restaurant-owner role.
--    SUPER_ADMIN is kept until existing records are migrated (Phase 1.2).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'KYRU_MANAGER'
                  AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Role'))
  THEN ALTER TYPE "Role" ADD VALUE 'KYRU_MANAGER'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'OWNER_SUPER_ADMIN'
                  AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Role'))
  THEN ALTER TYPE "Role" ADD VALUE 'OWNER_SUPER_ADMIN'; END IF;
END $$;

-- ── 2. Create owner_accounts table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "owner_accounts" (
  "id"        TEXT        NOT NULL,
  "name"      TEXT        NOT NULL,
  "email"     TEXT        NOT NULL,
  "active"    BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "owner_accounts_email_key"
  ON "owner_accounts"("email");

CREATE INDEX IF NOT EXISTS "owner_accounts_email_idx"
  ON "owner_accounts"("email");

-- ── 3. Update restaurants table ───────────────────────────────────────────────

-- Add ownerAccountId column
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "ownerAccountId" TEXT;

-- Add FK to owner_accounts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'restaurants_ownerAccountId_fkey'
      AND table_name = 'restaurants'
  ) THEN
    ALTER TABLE "restaurants"
      ADD CONSTRAINT "restaurants_ownerAccountId_fkey"
      FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "restaurants_ownerAccountId_idx"
  ON "restaurants"("ownerAccountId");

-- Remove old groupId self-referential column
-- (data in groupId is superseded by ownerAccountId; run Phase 1.2 data migration first
--  if you need to preserve groupId relationships as OwnerAccount records)
ALTER TABLE "restaurants" DROP COLUMN IF EXISTS "groupId";

-- ── 4. Update users table ─────────────────────────────────────────────────────

-- Add ownerAccountId (for OWNER_SUPER_ADMIN users)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ownerAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "users_ownerAccountId_idx"
  ON "users"("ownerAccountId");

-- Add createdAt / updatedAt if not present
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── Notes for Phase 1.2 ───────────────────────────────────────────────────────
-- After auth code is updated, optionally run:
--   UPDATE "users" SET role = 'KYRU_MANAGER' WHERE role = 'SUPER_ADMIN';
-- Then SUPER_ADMIN can be removed from the Role enum (requires no rows using it).
