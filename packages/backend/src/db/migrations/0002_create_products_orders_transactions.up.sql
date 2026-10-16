-- Migration: 0002 — create products, orders, order_items, transactions tables

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID        NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name         TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description  TEXT        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  price_cents  INTEGER     NOT NULL CHECK (price_cents >= 0),
  currency     TEXT        NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP', 'USD', 'EUR')),
  status       TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('active', 'draft', 'archived')),
  image_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_store_id ON products (store_id);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products (status);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
  reference       TEXT        NOT NULL UNIQUE CHECK (char_length(reference) BETWEEN 1 AND 64),
  status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
  total_cents     INTEGER     NOT NULL CHECK (total_cents >= 0),
  currency        TEXT        NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP', 'USD', 'EUR')),
  customer_name   TEXT        CHECK (char_length(customer_name) <= 200),
  customer_email  TEXT        CHECK (char_length(customer_email) <= 254),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_store_id  ON orders (store_id);
CREATE INDEX IF NOT EXISTS idx_orders_reference ON orders (reference);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders (status);

-- ---------------------------------------------------------------------------
-- Order items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id      UUID        REFERENCES products (id) ON DELETE SET NULL,
  product_name    TEXT        NOT NULL CHECK (char_length(product_name) BETWEEN 1 AND 200),
  quantity        INTEGER     NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER    NOT NULL CHECK (unit_price_cents >= 0),
  total_cents     INTEGER     NOT NULL CHECK (total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- Transactions (payment records — simulated only in this demo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
  order_id      UUID        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  -- Backend-generated token, never derived from client input
  payment_token TEXT        NOT NULL UNIQUE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'awaiting_payment', 'paid',
                                                'failed', 'expired', 'cancelled')),
  amount_cents  INTEGER     NOT NULL CHECK (amount_cents > 0),
  currency      TEXT        NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP', 'USD', 'EUR')),
  expires_at    TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_store_id ON transactions (store_id);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status   ON transactions (status);
-- Partial index speeds up "find pending non-expired tokens" queries
CREATE INDEX IF NOT EXISTS idx_transactions_token_active
  ON transactions (payment_token)
  WHERE status IN ('pending', 'awaiting_payment');
