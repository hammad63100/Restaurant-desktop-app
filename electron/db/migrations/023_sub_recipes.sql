-- 023_sub_recipes.sql
-- Roadmap 4.I — ingredients the kitchen makes itself (house mayo, marinade,
-- zinger mix, pizza sauce).
--
-- The client's answer to §15 Q4: "kuch cheezein hum khud banate hain" — some
-- things we make ourselves. Until now every ingredient had to be bought, so a
-- house sauce could only be faked by typing a guessed price into a purchase.
-- That guess would then be silently wrong forever, and nothing would tell the
-- owner when the price of oil rose.
--
-- The model:
--   * an ingredient may have its OWN batch recipe (ingredient_recipe_items);
--   * the batch turns out a known quantity (ingredients.batch_yield_base), because
--     "one kilo of mayo" is the useful unit, not "one batch";
--   * its cost per base unit is then Σ(line cost) ÷ yield, derived from the
--     ingredients that went into it — never typed;
--   * making a batch takes the components OFF the shelf and puts the product back
--     on, at that computed cost, so the weighted average of the product follows
--     the real prices of what it is made of.
--
-- Deliberately NOT modelled: a sub-recipe inside a sub-recipe, nested arbitrarily.
-- One level is what a fast-food kitchen actually has, and it makes the cost a
-- single pass with no recursion to get wrong. A sub-recipe containing another
-- sub-recipe is refused by the service with a message saying so.

-- ---------------------------------------------------------------------------
-- 1. The batch recipe.
-- ---------------------------------------------------------------------------

CREATE TABLE ingredient_recipe_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The ingredient being MADE (house mayo).
  ingredient_id      INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE CASCADE,
  -- An ingredient that goes INTO it (oil, egg).
  component_id       INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  -- Base units of the component per batch. Integers, same as menu recipes.
  qty_base           INTEGER NOT NULL CHECK (qty_base > 0),
  -- Trim/waste allowance as a percent ×100 (5% = 500), same semantics as 4.C.
  waste_percent_x100 INTEGER NOT NULL DEFAULT 0
                     CHECK (waste_percent_x100 >= 0 AND waste_percent_x100 <= 5000),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  -- An ingredient cannot be its own component...
  CHECK (ingredient_id <> component_id)
);

-- ...and one line per component: two rows for the same oil would make both the
-- cost and the deduction ambiguous.
CREATE UNIQUE INDEX idx_ingredient_recipe_items_component
  ON ingredient_recipe_items (ingredient_id, component_id);
CREATE INDEX idx_ingredient_recipe_items_component_id
  ON ingredient_recipe_items (component_id);

-- How many base units one batch produces (1000 g of mayo, 12 pcs of buns).
-- 0 = bought, not made. Kept on the ingredient because every screen that lists an
-- ingredient already reads that row, and "is this bought or made?" must be one
-- cheap check rather than a join.
ALTER TABLE ingredients ADD COLUMN batch_yield_base INTEGER NOT NULL DEFAULT 0
  CHECK (batch_yield_base >= 0);

-- ---------------------------------------------------------------------------
-- 2. A batch is a stock document, like a purchase or a wastage entry.
-- ---------------------------------------------------------------------------

CREATE TABLE sub_recipe_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no       TEXT    NOT NULL UNIQUE,
  ingredient_id  INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  -- Quantity produced, in the ingredient's base unit. Always > 0.
  qty_base       INTEGER NOT NULL CHECK (qty_base > 0),
  -- Σ(line cost) at the cost snapshot below, in paisa. Frozen on purpose: last
  -- week's batch cost what it cost, and a price rise today must not rewrite it.
  total_cost     INTEGER NOT NULL CHECK (total_cost >= 0),
  -- total_cost ÷ qty_base, in milli-paisa per base unit. Stored rather than
  -- recomputed so the shelf cost of this batch is exactly what the screen showed.
  unit_cost_milli INTEGER NOT NULL CHECK (unit_cost_milli >= 0),
  made_on        TEXT    NOT NULL,
  notes          TEXT    NOT NULL DEFAULT '',
  created_by     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at     TEXT    NOT NULL
);

CREATE INDEX idx_sub_recipe_batches_ingredient
  ON sub_recipe_batches (ingredient_id, made_on DESC);

-- The components consumed by a batch, frozen at the price they were on that day.
-- This is the record that lets the owner answer "why did the mayo cost more this
-- month?" without guessing.
CREATE TABLE sub_recipe_batch_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL REFERENCES sub_recipe_batches (id) ON DELETE CASCADE,
  component_id    INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  qty_base        INTEGER NOT NULL CHECK (qty_base > 0),
  unit_cost_milli INTEGER NOT NULL CHECK (unit_cost_milli >= 0),
  cost            INTEGER NOT NULL CHECK (cost >= 0)
);

CREATE INDEX idx_sub_recipe_batch_lines_batch ON sub_recipe_batch_lines (batch_id);

-- ---------------------------------------------------------------------------
-- 3. Two new ledger kinds: making a batch, and undoing one.
--
-- `stock_movements.kind` is a CHECK constraint, and SQLite cannot alter one. The
-- table has to be rebuilt — and with foreign_keys ON, DROP TABLE runs an implicit
-- DELETE that fails while other rows still reference the ingredients the
-- movements point at (either immediately, or 5.29's deferred RESTRICT at commit).
-- So: rebuild a copy, and switch the write path to the copy.
--
-- The original table is left in place, emptied, as `stock_movements_legacy_016`.
-- That is not laziness — it is the only shape that works on every SQLite 3.42+
-- version (the one Electron ships). Switching back needs two statements, which
-- matters because if a later step of this migration failed, the app would be left
-- with an empty ledger: money quietly disappearing. An empty legacy table is a
-- far smaller thing to explain.
-- ---------------------------------------------------------------------------

ALTER TABLE stock_movements RENAME TO stock_movements_legacy_016;

-- The rename carried the old table's indexes with it under their old names. They
-- are dropped here so the new table can own them; the legacy copy is empty and
-- needs no index to stay fast.
DROP INDEX IF EXISTS idx_stock_movements_ingredient;
DROP INDEX IF EXISTS idx_stock_movements_purchase;
DROP INDEX IF EXISTS idx_stock_movements_order;
DROP INDEX IF EXISTS idx_stock_movements_one_sale;
DROP INDEX IF EXISTS idx_stock_movements_kind_date;

CREATE TABLE stock_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id      INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  kind               TEXT    NOT NULL CHECK (
    kind IN ('opening', 'purchase', 'purchase_void', 'sale', 'sale_reversal',
             'wastage', 'adjustment', 'supplier_return', 'stock_count',
             'sub_recipe_make', 'sub_recipe_unmake')
  ),
  qty                INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost_milli    INTEGER NOT NULL CHECK (unit_cost_milli >= 0),
  reason             TEXT    NOT NULL DEFAULT '',
  ref_purchase_id    INTEGER REFERENCES purchases (id) ON DELETE SET NULL,
  ref_order_id       INTEGER REFERENCES orders (id) ON DELETE SET NULL,
  ref_order_item_id  INTEGER REFERENCES order_items (id) ON DELETE SET NULL,
  ref_batch_id       INTEGER REFERENCES sub_recipe_batches (id) ON DELETE SET NULL,
  wastage_reason     TEXT,
  created_by         INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at         TEXT    NOT NULL
);

-- The 016 indexes, rebuilt verbatim on the new table.
CREATE INDEX idx_stock_movements_ingredient ON stock_movements (ingredient_id, id DESC);
CREATE INDEX idx_stock_movements_purchase ON stock_movements (ref_purchase_id);
CREATE INDEX idx_stock_movements_order ON stock_movements (ref_order_id);
CREATE UNIQUE INDEX idx_stock_movements_one_sale
  ON stock_movements (ref_order_item_id, ingredient_id)
  WHERE kind = 'sale' AND ref_order_item_id IS NOT NULL;

-- Added by 021, rebuilt too.
CREATE INDEX idx_stock_movements_kind_date
  ON stock_movements (kind, created_at DESC);

-- New: a batch's movements, both the product made and the components consumed.
CREATE INDEX idx_stock_movements_batch
  ON stock_movements (ref_batch_id);

-- Move the history across, keep the id so anything that ever printed a movement
-- still points at the same row, then empty the old table.
INSERT INTO stock_movements
  (id, ingredient_id, kind, qty, unit_cost_milli, reason, ref_purchase_id,
   ref_order_id, ref_order_item_id, ref_batch_id, wastage_reason, created_by,
   created_at)
SELECT
  id, ingredient_id, kind, qty, unit_cost_milli, reason, ref_purchase_id,
  ref_order_id, ref_order_item_id, NULL, wastage_reason, created_by, created_at
FROM stock_movements_legacy_016;

-- The legacy table keeps its (now empty) shape and its indexes. SQLite renamed
-- those indexes with the table, so their names are freed for the new table above.
DELETE FROM stock_movements_legacy_016;
