-- Order idempotency keys are scoped to their merchant store. The previous
-- global unique constraint allowed one store's retry key to disclose another
-- store's order/payment token through the idempotent response.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_idempotency_key_key;

DROP INDEX IF EXISTS idx_orders_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_idempotency
  ON orders (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
