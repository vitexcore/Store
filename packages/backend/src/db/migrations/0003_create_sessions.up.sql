-- Migration: 0003 — create session table for server-side session storage
--
-- Used by connect-pg-simple (express-session store).
-- Stores session data server-side so that session cookies contain only
-- an opaque session ID, never the session payload itself.
-- This allows logout to truly invalidate a session by deleting the row.

CREATE TABLE IF NOT EXISTS session (
  sid         TEXT        NOT NULL COLLATE "default" PRIMARY KEY,
  sess        JSON        NOT NULL,
  expire      TIMESTAMP(6) NOT NULL
);

-- Speeds up cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
