-- Migration: 0001 — create stores and users tables
-- Applied by: src/db/migrate.ts

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug        TEXT        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores (slug);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID        REFERENCES stores (id) ON DELETE SET NULL,
  email          TEXT        NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 5 AND 254),
  -- Hashed with Argon2id. Raw passwords are NEVER stored.
  password_hash  TEXT        NOT NULL,
  role           TEXT        NOT NULL DEFAULT 'merchant'
                               CHECK (role IN ('admin', 'merchant', 'staff')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_store_id ON users (store_id);
