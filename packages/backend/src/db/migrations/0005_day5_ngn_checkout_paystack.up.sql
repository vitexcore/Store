-- Migration: 0005 — Day 5: NGN default currency, checkout idempotency, Paystack support
-- ---------------------------------------------------------------------------------
-- Changes:
--   1. Extend currency CHECK constraints to include NGN in products, orders,
--      transactions, and stores.
--   2. Change default currency to NGN on all tables.
--   3. Add idempotency_key to orders (client-supplied token to prevent duplicate orders).
--   4. Add paystack_reference and paystack_authorization_url to transactions.
--   5. Add index on transactions.paystack_reference for fast webhook lookups.
-- ---------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Products: extend currency check + change default
-- ---------------------------------------------------------------------------
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_currency_check;

ALTER TABLE products
  ADD CONSTRAINT products_currency_check
    CHECK (currency IN ('GBP', 'USD', 'EUR', 'NGN'));

ALTER TABLE products
  ALTER COLUMN currency SET DEFAULT 'NGN';

-- ---------------------------------------------------------------------------
-- 2. Orders: extend currency check + change default + add idempotency key
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_currency_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_currency_check
    CHECK (currency IN ('GBP', 'USD', 'EUR', 'NGN'));

ALTER TABLE orders
  ALTER COLUMN currency SET DEFAULT 'NGN';

-- Idempotency key: client-generated UUID for safe duplicate request detection.
-- Nullable so existing rows are unaffected. UNIQUE prevents true duplicate orders.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128);

CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Transactions: extend currency check + change default + add Paystack fields
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_currency_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_currency_check
    CHECK (currency IN ('GBP', 'USD', 'EUR', 'NGN'));

ALTER TABLE transactions
  ALTER COLUMN currency SET DEFAULT 'NGN';

-- Paystack-assigned reference for payment tracking.
-- Nullable: set during Paystack initialization, not at order creation.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT UNIQUE
    CHECK (paystack_reference IS NULL OR char_length(paystack_reference) BETWEEN 1 AND 255);

-- Authorization URL from Paystack initialize response (safe to store; contains no secret).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_paystack_ref
  ON transactions (paystack_reference)
  WHERE paystack_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Stores: extend currency check + change default
-- ---------------------------------------------------------------------------
ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_default_currency_check;

ALTER TABLE stores
  ADD CONSTRAINT stores_default_currency_check
    CHECK (default_currency IN ('GBP', 'USD', 'EUR', 'NGN'));

ALTER TABLE stores
  ALTER COLUMN default_currency SET DEFAULT 'NGN';
