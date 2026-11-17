-- 001_init.sql
-- Phase 1: user accounts and key/value app settings.

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  full_name            TEXT    NOT NULL DEFAULT '',
  role                 TEXT    NOT NULL CHECK (role IN ('admin', 'cashier', 'manager')),
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at        TEXT,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);

CREATE INDEX idx_users_role_active ON users (role, active);

-- Settings are strings on purpose: the repository converts numbers/booleans.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
