DROP INDEX IF EXISTS idx_products_store_create_idempotency;

ALTER TABLE products
  DROP COLUMN IF EXISTS create_idempotency_key;
