-- Migration: add_audit_log
-- Append-only audit trail for sensitive / irreversible actions.
-- Never modify or DELETE rows from this table.
--
-- Run against DIRECT_URL (postgres superuser, bypasses PgBouncer):
--   DATABASE_URL=$DIRECT_URL npx prisma db execute --file prisma/migrations/add_audit_log.sql
--
-- REVIEW CHECKLIST before running in production:
--   [ ] Back up production DB (Railway: Backups tab → Create backup)
--   [ ] Confirm DIRECT_URL is set (not the pooler URL)
--   [ ] Run against a staging clone first
--   [ ] Verify no active transactions on audit_logs table post-migration

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT        NOT NULL DEFAULT cuid(),
  "actorId"    TEXT,
  "actorRole"  TEXT,
  action       TEXT        NOT NULL,
  "targetType" TEXT        NOT NULL,
  "targetId"   TEXT        NOT NULL,
  metadata     JSONB,
  "requestId"  TEXT,
  "ipAddress"  TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);

-- Indexes for the most common lookup patterns
CREATE INDEX IF NOT EXISTS audit_logs_action_idx        ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx         ON audit_logs ("actorId");
CREATE INDEX IF NOT EXISTS audit_logs_target_idx        ON audit_logs ("targetType", "targetId");
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx    ON audit_logs ("createdAt");

-- Grant read access to the app role (reads only — no INSERT/UPDATE/DELETE from app)
-- INSERT is handled by the superuser via a server-side trusted path (lib/audit.ts).
GRANT SELECT ON audit_logs TO senda_app;
