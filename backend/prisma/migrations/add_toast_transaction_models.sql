-- Toast menu item → Kyru product mapping
CREATE TABLE IF NOT EXISTS toast_menu_items (
  id                TEXT        NOT NULL PRIMARY KEY,
  "restaurantId"    TEXT        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  "toastItemId"     TEXT        NOT NULL,
  "toastItemName"   TEXT        NOT NULL,
  "kyruProductId"   TEXT        REFERENCES products(id) ON DELETE SET NULL,
  "lastSyncedAt"    TIMESTAMPTZ NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("restaurantId", "toastItemId")
);

CREATE INDEX IF NOT EXISTS toast_menu_items_restaurant_id_idx ON toast_menu_items ("restaurantId");
CREATE INDEX IF NOT EXISTS toast_menu_items_product_id_idx    ON toast_menu_items ("kyruProductId");

-- Toast transaction audit log (immutable once synced)
CREATE TABLE IF NOT EXISTS toast_transactions (
  id                    TEXT        NOT NULL PRIMARY KEY,
  "restaurantId"        TEXT        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  "toastTransactionId"  TEXT        NOT NULL,
  "transactionDate"     TIMESTAMPTZ NOT NULL,
  amount                DOUBLE PRECISION NOT NULL,
  category              TEXT        NOT NULL,
  "itemDetails"         JSONB       NOT NULL DEFAULT '[]',
  "rawData"             JSONB       NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'synced',
  "syncedAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("restaurantId", "toastTransactionId")
);

CREATE INDEX IF NOT EXISTS toast_transactions_restaurant_id_idx      ON toast_transactions ("restaurantId");
CREATE INDEX IF NOT EXISTS toast_transactions_restaurant_date_idx    ON toast_transactions ("restaurantId", "transactionDate");
