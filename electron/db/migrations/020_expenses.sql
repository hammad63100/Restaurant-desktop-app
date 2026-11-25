-- 020_expenses.sql
-- Roadmap Phase 4.F — the shop's own expenses, so the hisab is complete.
--
-- The client: "shop k kharchy bhi add kron" — rent, electricity, salaries,
-- repairs, tea for the staff. These are NOT purchases: buying chicken puts value
-- on the shelf, paying the electricity bill does not. Keeping them apart is what
-- makes the profit & loss honest in 4.G.
--
-- Two rules carried over from the rest of the app:
--   * money in integer paisa,
--   * history is never deleted — a wrong entry is voided, with a reason and who
--     did it, and both the entry and the void stay visible.

CREATE TABLE expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL COLLATE NOCASE,
  -- Drawer cash (paid from the till) or money from outside (bank, owner's pocket).
  -- Only a hint: the entry itself decides where the money came from.
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_expense_categories_name ON expense_categories (name);

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_no    TEXT    NOT NULL UNIQUE,
  category_id   INTEGER NOT NULL REFERENCES expense_categories (id) ON DELETE RESTRICT,
  -- Calendar day the money was spent, so a late entry still lands in the right month.
  spent_on      TEXT    NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  -- Where the money came from. 'cash' = the till, 'bank'/'other' = outside.
  paid_from     TEXT    NOT NULL DEFAULT 'cash' CHECK (paid_from IN ('cash', 'bank', 'other')),
  payee         TEXT    NOT NULL DEFAULT '',
  notes         TEXT    NOT NULL DEFAULT '',
  -- Set when the expense was paid out of an open shift; NULL for outside money.
  shift_id      INTEGER REFERENCES shifts (id) ON DELETE SET NULL,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason   TEXT    NOT NULL DEFAULT '',
  voided_at     TEXT,
  voided_by     INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  created_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TEXT    NOT NULL
);

CREATE INDEX idx_expenses_date ON expenses (spent_on DESC, id DESC);
CREATE INDEX idx_expenses_category ON expenses (category_id, spent_on DESC);
CREATE INDEX idx_expenses_status ON expenses (status, spent_on DESC);

-- The drawer row that this expense wrote, so a void can reverse exactly that row
-- and nothing else. One expense can only ever write one drawer row.
ALTER TABLE cash_movements ADD COLUMN ref_expense_id INTEGER
  REFERENCES expenses (id) ON DELETE SET NULL;

CREATE INDEX idx_cash_movements_expense ON cash_movements (ref_expense_id);

-- A start list the owner can rename or delete, so the page is useful on day one.
INSERT INTO expense_categories (name, sort_order, is_system, active, created_at) VALUES
  ('Rent',                    1,  0, 1, datetime('now')),
  ('Electricity',             2,  0, 1, datetime('now')),
  ('Gas',                     3,  0, 1, datetime('now')),
  ('Water',                   4,  0, 1, datetime('now')),
  ('Salaries',                5,  0, 1, datetime('now')),
  ('Repairs & maintenance',   6,  0, 1, datetime('now')),
  ('Cleaning',                7,  0, 1, datetime('now')),
  ('Transport',               8,  0, 1, datetime('now')),
  ('Marketing',               9,  0, 1, datetime('now')),
  ('Tea & staff food',        10, 0, 1, datetime('now')),
  ('Government & fees',       11, 0, 1, datetime('now')),
  ('Other',                   99, 1, 1, datetime('now'));
