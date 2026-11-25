-- 009_shifts.sql
-- Day close: one open shift per terminal, cash movements, and the shift a payment
-- belongs to. expected_cash is derived when the shift closes, never computed on read.

CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  terminal      TEXT NOT NULL DEFAULT 'counter-1',
  opened_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at     TEXT NOT NULL,
  closed_by     INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  closed_at     TEXT,
  opening_cash  INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash INTEGER,
  counted_cash  INTEGER CHECK (counted_cash IS NULL OR counted_cash >= 0),
  difference    INTEGER,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes         TEXT NOT NULL DEFAULT ''
);

-- The database itself enforces "one open shift per terminal".
CREATE UNIQUE INDEX idx_shifts_one_open ON shifts(terminal) WHERE status = 'open';

CREATE TABLE cash_movements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL CHECK (kind IN ('sale', 'cash_in', 'cash_out', 'refund', 'expense')),
  method       TEXT NOT NULL DEFAULT 'cash',
  amount       INTEGER NOT NULL CHECK (amount > 0),
  reason       TEXT NOT NULL DEFAULT '',
  ref_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_cash_movements_shift ON cash_movements(shift_id, created_at);

-- Payments made while a shift is open are stamped with it, so the Z report is a
-- simple sum instead of a date guess.
ALTER TABLE payments ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;
CREATE INDEX idx_payments_shift ON payments(shift_id);
