-- 016_purchases.sql
-- Roadmap Phase 4.B — purchases and the stock ledger.
--
-- Rules this schema enforces (docs/inventory-expenses-plan.md §4):
--   * a purchase keeps every line's own price forever,
--   * stock only changes through stock_movements,
--   * a posted purchase is voided, never edited or deleted.

CREATE TABLE purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no    TEXT    NOT NULL UNIQUE,
  supplier_id    INTEGER REFERENCES suppliers (id) ON DELETE RESTRICT,
  bill_no        TEXT    NOT NULL DEFAULT '',
  purchased_on   TEXT    NOT NULL,
  subtotal       INTEGER NOT NULL CHECK (subtotal >= 0),
  extra_charges  INTEGER NOT NULL DEFAULT 0 CHECK (extra_charges >= 0),
  total          INTEGER NOT NULL CHECK (total >= 0),
  paid_amount    INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_method TEXT    NOT NULL CHECK (
    payment_method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit')
  ),
  status         TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  notes          TEXT    NOT NULL DEFAULT '',
  void_reason    TEXT    NOT NULL DEFAULT '',
  voided_at      TEXT,
  voided_by      INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  created_by     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at     TEXT    NOT NULL
);

CREATE INDEX idx_purchases_date ON purchases (purchased_on);
CREATE INDEX idx_purchases_supplier ON purchases (supplier_id);

-- One line = one ingredient as bought: its own quantity, its own price, its own
-- share of the transport cost (landed_cost_milli).
CREATE TABLE purchase_items (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id          INTEGER NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  ingredient_id        INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  -- Quantity in purchase units ×1000, so 2.5 kg is stored exactly as 2500.
  qty_purchase_milli   INTEGER NOT NULL CHECK (qty_purchase_milli > 0),
  -- The same quantity converted to base units (2.5 kg → 2500 g).
  qty_base             INTEGER NOT NULL CHECK (qty_base > 0),
  -- Price per purchase unit, integer paisa (Rs 710/kg = 71000).
  unit_price           INTEGER NOT NULL CHECK (unit_price >= 0),
  -- Landed cost per base unit in milli-paisa, after extra charges are spread.
  landed_cost_milli    INTEGER NOT NULL CHECK (landed_cost_milli >= 0),
  -- Invoice value of the line, in paisa, before extra charges.
  line_total           INTEGER NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX idx_purchase_items_ingredient ON purchase_items (ingredient_id);

-- The single source of truth for stock. ingredients.qty_on_hand is a cache of
-- this table; every row here is written in the same transaction as that update.
CREATE TABLE stock_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id      INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  kind               TEXT    NOT NULL CHECK (
    kind IN ('opening', 'purchase', 'purchase_void', 'sale', 'sale_reversal',
             'wastage', 'adjustment', 'supplier_return', 'stock_count')
  ),
  -- Signed base units: + adds to the shelf, − takes from it.
  qty                INTEGER NOT NULL CHECK (qty <> 0),
  -- milli-paisa per base unit at the time of the movement.
  unit_cost_milli    INTEGER NOT NULL CHECK (unit_cost_milli >= 0),
  reason             TEXT    NOT NULL DEFAULT '',
  ref_purchase_id    INTEGER REFERENCES purchases (id) ON DELETE RESTRICT,
  ref_order_id       INTEGER REFERENCES orders (id) ON DELETE RESTRICT,
  -- SET NULL, not RESTRICT: an amendment deletes the old lines of a bill, and the
  -- ledger must survive that. ref_order_id keeps the history pointing at the bill.
  ref_order_item_id  INTEGER REFERENCES order_items (id) ON DELETE SET NULL,
  created_by         INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at         TEXT    NOT NULL
);

CREATE INDEX idx_stock_movements_ingredient ON stock_movements (ingredient_id, id DESC);
CREATE INDEX idx_stock_movements_purchase ON stock_movements (ref_purchase_id);
CREATE INDEX idx_stock_movements_order ON stock_movements (ref_order_id);

-- A saved order line can deduct the same ingredient only once. Replaying a save,
-- a double click or an amend loop therefore cannot take the stock twice.
CREATE UNIQUE INDEX idx_stock_movements_one_sale
  ON stock_movements (ref_order_item_id, ingredient_id)
  WHERE kind = 'sale' AND ref_order_item_id IS NOT NULL;
