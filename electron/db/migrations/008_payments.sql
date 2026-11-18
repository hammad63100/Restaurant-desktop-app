-- 008_payments.sql
-- Payment methods, paid/unpaid tracking and the customer (udhaar) ledger.
-- Money is integer paisa everywhere. The shift_id column arrives in 009 with the
-- shifts table so this migration stands alone.

ALTER TABLE orders ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded'));

CREATE TABLE payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  method      TEXT NOT NULL CHECK (
    method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit')
  ),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  tendered    INTEGER CHECK (tendered IS NULL OR tendered >= 0),
  change_due  INTEGER CHECK (change_due IS NULL OR change_due >= 0),
  reference   TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL,
  voided_at   TEXT,
  void_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- One row per money event on a customer account: a charge (udhaar taken) or a
-- payment (udhaar settled). balance_after is a running statement balance.
CREATE TABLE customer_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  payment_id    INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  entry_type    TEXT NOT NULL CHECK (entry_type IN ('charge', 'payment')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  balance_after INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_customer_ledger_customer ON customer_ledger(customer_id, created_at);

-- Existing orders start unpaid with nothing paid; nothing to backfill because the
-- defaults above cover every row, but be explicit for clarity.
UPDATE orders SET paid_amount = 0, payment_status = 'unpaid';
