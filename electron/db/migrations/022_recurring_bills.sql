-- 022_recurring_bills.sql
-- Roadmap Phase 4.E2 — the bills that arrive every month whether the shop is busy
-- or not: rent, electricity, gas, internet, the water tanker.
--
-- Why this is not just "remember to type the rent again":
--
--   * The owner does not need a form on the 1st of every month. He needs the app to
--     tell him "rent is due in 3 days" and remember whether he already paid it.
--   * The bill is an expectation, not an expense. Nothing enters the P&L until he
--     confirms the amount he actually paid — a reminder that silently booked
--     Rs 50,000 of rent in a month he did not pay it would be worse than none.
--   * Electricity is never the same twice, so the template carries a typical amount
--     used to pre-fill the form, never to post anything.
--
-- A bill is per calendar month: "rent for 2026-11" is one row, and a UNIQUE index on
-- (template_id, period) is what stops a double payment being recorded twice.

CREATE TABLE recurring_bills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- What the bill is for. The category is what makes it land in the right line of
  -- the expenses report, so it is required, not a free-text label.
  category_id  INTEGER NOT NULL REFERENCES expense_categories (id) ON DELETE RESTRICT,
  name         TEXT    NOT NULL,
  -- The amount last paid / the typical amount, in paisa. 0 = unknown, and the form
  -- opens blank rather than pre-filled with a lie.
  typical_amount INTEGER NOT NULL DEFAULT 0 CHECK (typical_amount >= 0),
  -- Day of the month it is due (1-31). 31 in a 30-day month means "the last day".
  due_day      INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  -- How many days before the due date the dashboard starts warning.
  remind_days  INTEGER NOT NULL DEFAULT 3 CHECK (remind_days BETWEEN 0 AND 30),
  payee        TEXT    NOT NULL DEFAULT '',
  paid_from    TEXT    NOT NULL DEFAULT 'bank' CHECK (paid_from IN ('cash', 'bank', 'other')),
  notes        TEXT    NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_recurring_bills_active ON recurring_bills (active, due_day);

-- One row per template per month. Written when the owner confirms he paid it (or
-- explicitly skips it), not when the reminder fires.
CREATE TABLE recurring_bill_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL REFERENCES recurring_bills (id) ON DELETE CASCADE,
  -- 'YYYY-MM' — the month this payment settles.
  period        TEXT    NOT NULL,
  -- The expense row this created, so the money is counted exactly once and the
  -- payment can be traced back to the hisab. NULL for a skip.
  expense_id    INTEGER REFERENCES expenses (id) ON DELETE SET NULL,
  amount        INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- 'paid' books an expense; 'skipped' records "not this month" without one.
  status        TEXT    NOT NULL CHECK (status IN ('paid', 'skipped')),
  note          TEXT    NOT NULL DEFAULT '',
  created_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TEXT    NOT NULL,
  UNIQUE (template_id, period)
);

CREATE INDEX idx_recurring_bill_payments_period ON recurring_bill_payments (period, status);
