-- 019_deduction.sql
-- Roadmap Phase 4.D — the kitchen takes stock off the shelf when food is sold.
--
-- Two things are added:
--   1. order_items.cost_total — what the lines on a saved bill actually cost to
--      make, frozen at sale time. Old bills are NOT back-filled: NULL means "no
--      cost data", which is the honest answer for a bill saved before 4.C.
--   2. order_item_stock — the per-ingredient snapshot behind that number, so the
--      owner can see what a bill consumed and re-value it if needed.

ALTER TABLE order_items ADD COLUMN cost_total INTEGER
  CHECK (cost_total IS NULL OR cost_total >= 0);

-- One row per (order line, ingredient): the recipe was one bun, 150 g chicken…
-- The unique index in migration 016 already stops a double sale deduction.
CREATE TABLE order_item_stock (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id   INTEGER NOT NULL REFERENCES order_items (id) ON DELETE CASCADE,
  ingredient_id   INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  qty_base        INTEGER NOT NULL CHECK (qty_base > 0),
  -- milli-paisa per base unit at the moment of the sale (the cost snapshot).
  unit_cost_milli INTEGER NOT NULL CHECK (unit_cost_milli >= 0),
  -- qty × unit cost rounded to paisa.
  cost            INTEGER NOT NULL CHECK (cost >= 0),
  created_at      TEXT    NOT NULL
);

CREATE INDEX idx_order_item_stock_line ON order_item_stock (order_item_id);
CREATE INDEX idx_order_item_stock_ingredient ON order_item_stock (ingredient_id);

-- Reports read "cost of goods sold" by date, so keep the join cheap.
CREATE INDEX idx_order_items_cost ON order_items (cost_total) WHERE cost_total IS NOT NULL;
