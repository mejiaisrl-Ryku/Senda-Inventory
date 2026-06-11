-- Add email capture to leads (landing trial form).
-- Nullable: rows captured before the email field existed have no address;
-- the API requires it for all new leads (zod, leadsController).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "email" TEXT;
