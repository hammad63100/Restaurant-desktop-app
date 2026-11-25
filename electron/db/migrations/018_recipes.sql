-- 018_recipes.sql
-- Roadmap Phase 4.C — what goes into one serving.
--
-- A recipe line says: this menu item uses this many base units of this
-- ingredient. Quantities are integers in the ingredient's own base unit, so
-- "150 g chicken" is stored as 150 and never as 0.15 kg.
--
-- The recipe is keyed by item only (no variant key yet). Variants are separate
-- menu items today, so nothing needs rewriting when they arrive.

CREATE TABLE recipe_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  qty_base     INTEGER NOT NULL CHECK (qty_base > 0),
  -- Waste/trim allowance as a percent ×100 (5% = 500). Cooking loss on chicken is
  -- real; the deduction scales by this without changing the recipe's cost line.
  waste_percent_x100 INTEGER NOT NULL DEFAULT 0 CHECK (waste_percent_x100 >= 0 AND waste_percent_x100 <= 5000),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

-- One line per ingredient per item: two lines for the same mayo would make the
-- cost and the deduction ambiguous.
CREATE UNIQUE INDEX idx_recipe_items_item_ingredient ON recipe_items (item_id, ingredient_id);
CREATE INDEX idx_recipe_items_ingredient ON recipe_items (ingredient_id);

-- The owner sets a margin floor; an item below it is flagged "Check price".
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('margin_alert_percent', '35', datetime('now', 'localtime'));

-- Selling below zero stock is a data-entry delay at the counter, not a reason to
-- refuse a customer. The owner can switch to blocking in Settings.
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('allow_negative_stock', '1', datetime('now', 'localtime'));

-- When the kitchen runs out, the menu can mark the item sold out by itself.
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('auto_sold_out', '0', datetime('now', 'localtime'));
