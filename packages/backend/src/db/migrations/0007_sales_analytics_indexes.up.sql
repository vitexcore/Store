-- Indexes supporting sales analytics aggregation.
--
-- Analytics filters confirmed orders for one store and one currency, then dates
-- each qualifying sale by its verified paid transaction.

CREATE INDEX IF NOT EXISTS idx_orders_store_status_currency
  ON orders (store_id, status, currency);

CREATE INDEX IF NOT EXISTS idx_transactions_paid_order_paid_at
  ON transactions (order_id, paid_at)
  WHERE status = 'paid';
