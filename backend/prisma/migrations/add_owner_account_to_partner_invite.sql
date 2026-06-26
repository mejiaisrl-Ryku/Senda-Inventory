-- Migration: Link PartnerInvite to OwnerAccount for owner-only invites
--
-- Apply via Railway DB console:
--   railway connect postgres  →  \i prisma/migrations/add_owner_account_to_partner_invite.sql
-- OR paste directly into the Railway Postgres query interface.
--
-- This migration is idempotent (uses IF NOT EXISTS / IF EXISTS guards).
-- The schema.prisma change will also be applied automatically on next
-- Railway deploy via `prisma db push`.
--
-- Background: createOwnerAccount() was reusing the partner-invite/setup flow,
-- which always created a brand-new restaurant + ADMIN user on acceptance —
-- even for owner invites. Adding ownerAccountId lets completePartnerSetup()
-- distinguish "this invite provisions an OWNER_SUPER_ADMIN on an existing
-- OwnerAccount" from "this invite provisions a brand-new restaurant".

ALTER TABLE "partner_invites"
  ADD COLUMN IF NOT EXISTS "ownerAccountId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'partner_invites_ownerAccountId_fkey'
      AND table_name = 'partner_invites'
  ) THEN
    ALTER TABLE "partner_invites"
      ADD CONSTRAINT "partner_invites_ownerAccountId_fkey"
      FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
