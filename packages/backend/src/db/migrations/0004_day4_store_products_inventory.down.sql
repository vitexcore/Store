-- Rollback: 0004 — Day 4 additions

DROP TABLE IF EXISTS inventory_adjustments;

DROP INDEX IF EXISTS idx_products_store_stock;

ALTER TABLE products
  DROP COLUMN IF EXISTS stock_quantity,
  DROP COLUMN IF EXISTS low_stock_threshold;

ALTER TABLE stores
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS default_currency;
