-- Add locationCount to restaurants (1 = single-location, 2+ = multi-location group)
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS "locationCount" INTEGER NOT NULL DEFAULT 1;

-- Store intended location count on the partner invite so it carries through onboarding
ALTER TABLE partner_invites
  ADD COLUMN IF NOT EXISTS "locationCount" INTEGER NOT NULL DEFAULT 1;
