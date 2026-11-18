-- 010_discounts.sql
-- Discount rules per role, promo codes, and the approval audit trail.
-- Percentages are stored x100 so 5.50% is 550 (no floats anywhere).

CREATE TABLE discount_rules (
  id                                 INTEGER PRIMARY KEY AUTOINCREMENT,
  role                               TEXT NOT NULL UNIQUE
                                     CHECK (role IN ('cashier', 'manager', 'admin')),
  max_percent_x100                   INTEGER NOT NULL DEFAULT 0 CHECK (max_percent_x100 >= 0),
  max_amount                         INTEGER CHECK (max_amount IS NULL OR max_amount >= 0),
  requires_approval_above_percent_x100 INTEGER NOT NULL DEFAULT 0
                                     CHECK (requires_approval_above_percent_x100 >= 0),
  active                             INTEGER NOT NULL DEFAULT 1
);

-- Sensible starting rules: a cashier may give a small discount freely, a manager more.
INSERT INTO discount_rules
  (role, max_percent_x100, max_amount, requires_approval_above_percent_x100, active)
VALUES
  ('cashier', 1000, NULL, 500, 1),
  ('manager', 5000, NULL, 2500, 1),
  ('admin', 10000, NULL, 0, 1);

CREATE TABLE promo_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- percent: value is percent x100 (1500 = 15%). fixed: value is paisa.
  value      INTEGER NOT NULL CHECK (value > 0),
  min_order  INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  valid_from TEXT,
  valid_to   TEXT,
  max_uses   INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses       INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE discount_approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by  INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  percent_x100 INTEGER NOT NULL DEFAULT 0,
  amount       INTEGER NOT NULL DEFAULT 0,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_discount_approvals_order ON discount_approvals(order_id);

ALTER TABLE orders ADD COLUMN discount_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN promo_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
