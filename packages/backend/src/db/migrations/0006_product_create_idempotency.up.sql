-- Give product-create retries a durable idempotency key, scoped to each store.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS create_idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_create_idempotency
  ON products (store_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;
