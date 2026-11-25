-- 012_tables.sql
-- Dine-in tables, merging two open bills into one, and splitting a bill into a
-- second order.
--
-- The rule that shapes all of this: **payments never move**. Once money has been
-- recorded against an order it stays there. Merging therefore refuses orders that
-- have been paid, and splitting refuses to move a line that somebody has already
-- paid for. A till that quietly re-parents money is a till nobody can audit.

CREATE TABLE tables (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  seats      INTEGER NOT NULL DEFAULT 4 CHECK (seats > 0),
  area       TEXT    NOT NULL DEFAULT '',          -- e.g. 'Ground floor', 'Family hall'
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);

INSERT INTO tables (name, seats, area, active, created_at) VALUES
  ('T1', 2, 'Ground floor', 1, datetime('now')),
  ('T2', 2, 'Ground floor', 1, datetime('now')),
  ('T3', 4, 'Ground floor', 1, datetime('now')),
  ('T4', 4, 'Ground floor', 1, datetime('now')),
  ('T5', 4, 'Family hall', 1, datetime('now')),
  ('T6', 6, 'Family hall', 1, datetime('now')),
  ('T7', 6, 'Family hall', 1, datetime('now')),
  ('T8', 8, 'Family hall', 1, datetime('now'));

-- Which table a dine-in order sits at. NULL for takeaway and delivery, and also
-- for old dine-in orders created before tables existed.
ALTER TABLE orders ADD COLUMN table_id INTEGER REFERENCES tables (id) ON DELETE SET NULL;

CREATE INDEX idx_orders_table ON orders (table_id);

-- A merge points the orders it absorbed at the order that survived, so the old
-- number still means something when a customer quotes it.
ALTER TABLE orders ADD COLUMN merged_into_order_id INTEGER REFERENCES orders (id) ON DELETE SET NULL;

CREATE INDEX idx_orders_merged_into ON orders (merged_into_order_id);

-- A split records where a line came from, so "this bill was carved out of ORD-12"
-- survives in the data and not only in a log file.
ALTER TABLE orders ADD COLUMN split_from_order_id INTEGER REFERENCES orders (id) ON DELETE SET NULL;

CREATE INDEX idx_orders_split_from ON orders (split_from_order_id);

-- Every merge and split, for the audit trail. Money is not touched by these
-- operations, but the paperwork still has to say who did it.
CREATE TABLE order_combines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('merge', 'split')),
  source_id     INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  target_id     INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- For a split: the order_item ids that moved, as JSON. Empty for a merge.
  item_ids      TEXT    NOT NULL DEFAULT '[]',
  amount        INTEGER NOT NULL DEFAULT 0,   -- the paisa that moved, for reporting
  reason        TEXT    NOT NULL DEFAULT '',
  created_by    INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TEXT    NOT NULL
);

CREATE INDEX idx_order_combines_source ON order_combines (source_id);
CREATE INDEX idx_order_combines_target ON order_combines (target_id);
