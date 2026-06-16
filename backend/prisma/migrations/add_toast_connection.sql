-- Add Toast POS OAuth connection table.
-- Run in Railway console or via `psql` against the production database.
-- Tokens are stored AES-256-GCM encrypted by the application layer.

CREATE TABLE IF NOT EXISTS toast_connections (
  id                TEXT        NOT NULL PRIMARY KEY,
  "restaurantId"    TEXT        NOT NULL UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
  "toastLocationId" TEXT        NOT NULL,
  "accessToken"     TEXT        NOT NULL,
  "refreshToken"    TEXT        NOT NULL,
  "expiresAt"       TIMESTAMPTZ NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS toast_connections_restaurant_id_idx ON toast_connections ("restaurantId");
