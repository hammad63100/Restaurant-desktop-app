-- 013_amendments.sql
-- Editing a bill after it was saved.
--
-- An amendment is a full replacement of the order's lines, written as a new
-- "version" and kept forever:
--
--   * `order_amendments` holds one row per edit: who, when, why, and a full JSON
--     snapshot of what the bill looked like before and after.
--   * `orders.amendment_count` is a cheap counter for lists and receipts.
--
-- Nothing is updated in place without a snapshot. A shop that cannot answer "who
-- changed this bill and what did it say before" has no defence the first time a
-- customer disputes a total.

CREATE TABLE order_amendments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- 1 for the first edit, 2 for the next, so the history reads in order.
  version     INTEGER NOT NULL CHECK (version > 0),
  reason      TEXT    NOT NULL,
  -- Full JSON snapshots: totals plus the lines, exactly as they were.
  before_json TEXT    NOT NULL,
  after_json  TEXT    NOT NULL,
  changed_by  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_order_amendments_version ON order_amendments (order_id, version);

-- A cheap way to show "edited" in a list or on a receipt without a join.
ALTER TABLE orders ADD COLUMN amendment_count INTEGER NOT NULL DEFAULT 0;
