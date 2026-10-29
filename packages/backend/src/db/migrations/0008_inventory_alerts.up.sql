-- Migration: 0008 — supporting index for inventory alert queries
--
-- Alerts are calculated dynamically from the products table (no persisted
-- alert rows), so no new table is introduced. This composite index makes the
-- low-stock / out-of-stock / inactive lookups used by getInventoryAlerts()
-- efficient as the catalogue grows.

CREATE INDEX IF NOT EXISTS idx_inventory_alerts_store_stock_status
  ON products (store_id, stock_quantity, status);
