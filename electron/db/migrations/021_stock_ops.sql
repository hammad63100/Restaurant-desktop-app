-- 021_stock_ops.sql
-- Roadmap Phase 4.F — the three ways stock changes that are neither a purchase nor
-- a sale: wastage, an adjustment, and a stock count.
--
-- Until now the app could only learn about these through a typed number, which is
-- exactly the hole that makes a stock figure untrustworthy after a month of use:
--
--   * the cook drops a tray, oil is changed, a bun goes stale  → **wastage**
--   * the owner corrects a known mistake (miscount on delivery) → **adjustment**
--   * the owner counts the shelf and the count disagrees         → **stock count**
--
-- All three are already legal `stock_movements.kind` values (016), so no new ledger
-- is needed. What is missing is the paperwork around them: who, when, why, and for a
-- count, what the book said before the counted number was applied. That lives here.

CREATE TABLE stock_counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no    TEXT    NOT NULL UNIQUE,
  counted_on  TEXT    NOT NULL,
  -- Sum of |variance| × average cost: how much money the count was out by. Stored
  -- so an old count still shows what it was worth even after prices move.
  variance_value INTEGER NOT NULL DEFAULT 0,
  line_count  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT    NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_stock_counts_date ON stock_counts (counted_on DESC, id DESC);

CREATE TABLE stock_count_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id      INTEGER NOT NULL REFERENCES stock_counts (id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  -- What the ledger said at the moment of the count.
  book_qty      INTEGER NOT NULL,
  -- What the owner actually counted on the shelf.
  counted_qty   INTEGER NOT NULL CHECK (counted_qty >= 0),
  -- counted − book. Positive means unrecorded stock was found.
  variance      INTEGER NOT NULL,
  -- The average cost used to value the variance, so the paperwork never moves.
  unit_cost_milli INTEGER NOT NULL,
  variance_value  INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_stock_count_lines_one ON stock_count_lines (count_id, ingredient_id);
CREATE INDEX idx_stock_count_lines_ingredient ON stock_count_lines (ingredient_id);

-- Wastage gets a reason code so the report can group it without guessing at free
-- text. The text stays for the human detail ("dropped a tray of patties").
ALTER TABLE stock_movements ADD COLUMN wastage_reason TEXT
  CHECK (
    wastage_reason IS NULL OR
    wastage_reason IN ('spoiled', 'dropped', 'expired', 'staff_meal', 'test', 'other')
  );

CREATE INDEX idx_stock_movements_kind_date ON stock_movements (kind, created_at DESC);
