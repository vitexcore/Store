-- Migration: 0004 — Day 4 additions
-- Extends stores and products tables; adds inventory_adjustments table.

-- ---------------------------------------------------------------------------
-- Extend stores table
-- ---------------------------------------------------------------------------
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS description     TEXT         CHECK (char_length(description) <= 1000),
  ADD COLUMN IF NOT EXISTS contact_email   TEXT         CHECK (char_length(contact_email) <= 254),
  ADD COLUMN IF NOT EXISTS address         TEXT         CHECK (char_length(address) <= 500),
  ADD COLUMN IF NOT EXISTS default_currency TEXT        NOT NULL DEFAULT 'GBP'
                                             CHECK (default_currency IN ('GBP', 'USD', 'EUR'));

-- ---------------------------------------------------------------------------
-- Extend products table with inventory columns
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_quantity     INTEGER NOT NULL DEFAULT 0
                                               CHECK (stock_quantity >= 0),
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5
                                               CHECK (low_stock_threshold >= 0);

-- Index to efficiently find low-stock products per store
CREATE INDEX IF NOT EXISTS idx_products_store_stock
  ON products (store_id, stock_quantity);

-- ---------------------------------------------------------------------------
-- Inventory adjustments (audit log of all stock changes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID        NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- Positive = stock added, negative = stock removed
  delta       INTEGER     NOT NULL CHECK (delta <> 0),
  reason      TEXT        NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_product_id ON inventory_adjustments (product_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_store_id   ON inventory_adjustments (store_id);
