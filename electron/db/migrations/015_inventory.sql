-- 015_inventory.sql
-- Roadmap Phase 4.A — ingredients and suppliers (the foundation of stock).
--
-- Money rules (docs/Rules.md): amounts are INTEGER paisa. Quantities are INTEGER
-- base units (g / ml / pcs). Unit costs are MILLI-PAISA per base unit
-- (paisa × 1000) so a fraction of a paisa per gram does not round to zero.
--
-- The ledger tables (purchases, stock_movements, recipes) arrive in 016/017.
-- ingredients.qty_on_hand is a CACHED total of that ledger and is only ever
-- written together with a movement, never straight from a screen.

CREATE TABLE suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL DEFAULT '',
  address    TEXT    NOT NULL DEFAULT '',
  notes      TEXT    NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

-- Case-insensitive uniqueness: "Metro Cash" and "metro cash" are one supplier.
CREATE UNIQUE INDEX idx_suppliers_name ON suppliers (name COLLATE NOCASE);

CREATE TABLE ingredients (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  category            TEXT    NOT NULL DEFAULT 'Other',
  base_unit           TEXT    NOT NULL CHECK (base_unit IN ('g', 'ml', 'pcs')),
  purchase_unit       TEXT    NOT NULL DEFAULT 'kg',
  -- 1 kg = 1000 g, 1 dozen = 12 pcs, 1 packet of 100 boxes = 100 pcs.
  units_per_purchase  INTEGER NOT NULL DEFAULT 1000 CHECK (units_per_purchase > 0),
  reorder_level       INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  -- Cached ledger total. May be negative when a sale outran the purchase entry.
  qty_on_hand         INTEGER NOT NULL DEFAULT 0,
  -- milli-paisa per base unit.
  avg_cost_milli      INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_milli >= 0),
  last_cost_milli     INTEGER NOT NULL DEFAULT 0 CHECK (last_cost_milli >= 0),
  supplier_id         INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_ingredients_name ON ingredients (name COLLATE NOCASE);
CREATE INDEX idx_ingredients_category ON ingredients (category);
CREATE INDEX idx_ingredients_supplier ON ingredients (supplier_id);
