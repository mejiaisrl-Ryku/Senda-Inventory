-- Sprint 1: async Claude-Vision scan infrastructure.
-- Adds scan_jobs table (replaces synchronous extract-invoice / inventory-scan
-- request handling) and enables RLS to match every other restaurant-scoped
-- table (see 20260608130000_enable_rls_tenant_isolation).

-- 1. Enums
CREATE TYPE "ScanJobType" AS ENUM ('INVOICE', 'INVENTORY');
CREATE TYPE "ScanJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- 2. scan_jobs table
CREATE TABLE IF NOT EXISTS "scan_jobs" (
  "id"                 TEXT            NOT NULL DEFAULT gen_random_uuid()::text,
  "type"               "ScanJobType"   NOT NULL,
  "status"             "ScanJobStatus" NOT NULL DEFAULT 'PENDING',

  "restaurantId"       TEXT            NOT NULL,

  "imageS3Url"         TEXT            NOT NULL,
  "imageMimeType"      TEXT            NOT NULL,
  "imageSizeBytes"     INTEGER         NOT NULL,

  "claudeModel"        TEXT            NOT NULL DEFAULT 'claude-sonnet-4-5',
  "inputTokens"        INTEGER,
  "outputTokens"       INTEGER,
  "claudeProcessingMs" INTEGER,

  "extractedData"      JSONB,
  "extractionError"    TEXT,

  "retryCount"         INTEGER         NOT NULL DEFAULT 0,
  "maxRetries"         INTEGER         NOT NULL DEFAULT 3,
  "lastRetryAt"        TIMESTAMPTZ,

  "webhookUrl"         TEXT,
  "webhookDelivered"   TIMESTAMPTZ,
  "webhookError"       TEXT,

  "createdAt"          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  "startedAt"          TIMESTAMPTZ,
  "completedAt"        TIMESTAMPTZ,

  CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scan_jobs_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "scan_jobs_status_idx"               ON "scan_jobs"("status");
CREATE INDEX IF NOT EXISTS "scan_jobs_restaurantId_idx"         ON "scan_jobs"("restaurantId");
CREATE INDEX IF NOT EXISTS "scan_jobs_restaurantId_status_idx"  ON "scan_jobs"("restaurantId", "status");
CREATE INDEX IF NOT EXISTS "scan_jobs_type_idx"                 ON "scan_jobs"("type");
CREATE INDEX IF NOT EXISTS "scan_jobs_createdAt_idx"            ON "scan_jobs"("createdAt");

-- 3. RLS — same fail-closed pattern as every other restaurant-scoped table.
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_jobs FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON scan_jobs
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));

-- senda_app / senda_admin already have blanket grants via
-- ALTER DEFAULT PRIVILEGES from the RLS migration, so no GRANT needed here.
