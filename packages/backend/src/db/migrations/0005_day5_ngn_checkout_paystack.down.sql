-- Rollback: 0005 — Day 5 changes
-- Removes NGN support, idempotency_key, and Paystack columns.
-- WARNING: Any orders/products/transactions using NGN currency will violate
-- the restored constraints. Migrate data before rolling back in production.

-- Stores
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_default_currency_check;
ALTER TABLE stores ADD CONSTRAINT stores_default_currency_check
  CHECK (default_currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE stores ALTER COLUMN default_currency SET DEFAULT 'GBP';

-- Products
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_currency_check;
ALTER TABLE products ADD CONSTRAINT products_currency_check
  CHECK (currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE products ALTER COLUMN currency SET DEFAULT 'GBP';

-- Orders
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_currency_check;
ALTER TABLE orders ADD CONSTRAINT orders_currency_check
  CHECK (currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'GBP';
DROP INDEX IF EXISTS idx_orders_idempotency;
ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key;

-- Transactions
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_currency_check
  CHECK (currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'GBP';
DROP INDEX IF EXISTS idx_transactions_paystack_ref;
ALTER TABLE transactions DROP COLUMN IF EXISTS paystack_reference;
ALTER TABLE transactions DROP COLUMN IF EXISTS paystack_authorization_url;
