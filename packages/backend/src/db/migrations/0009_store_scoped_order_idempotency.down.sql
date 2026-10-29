-- Rolling back restores global uniqueness. This can fail if the application
-- has accepted the same key in more than one store since migration 0009.
DROP INDEX IF EXISTS idx_orders_store_idempotency;

ALTER TABLE orders
  ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_orders_idempotency
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
