-- 011_kot.sql
-- Kitchen order tickets (KOT) and the customer-facing order token.
--
-- Two separate things that people often confuse:
--   * the TOKEN is the number handed to a takeaway/dine-in customer, per day;
--   * the KOT is the slip the kitchen cooks from, which shows quantities and
--     notes but never prices.
--
-- Tokens are allocated from a per-day counter, so they restart at 1 each morning.
-- Cancelling an order does NOT release its token: a number that has been called
-- out loud cannot be re-issued, or two customers would hold the same one.

CREATE TABLE token_counters (
  day   TEXT    PRIMARY KEY,          -- YYYY-MM-DD, shop local date
  last  INTEGER NOT NULL DEFAULT 0 CHECK (last >= 0)
);

ALTER TABLE orders ADD COLUMN token_no INTEGER;

-- One order per token per day. NULL is allowed so old and delivery orders are
-- unaffected, and SQLite treats each NULL as distinct in a unique index.
CREATE UNIQUE INDEX idx_orders_token_day ON orders (date(created_at), token_no)
  WHERE token_no IS NOT NULL;

-- Every kitchen ticket ever printed, so a reprint can be told apart from the
-- first print. Replaces an "is_printed" flag with something auditable.
CREATE TABLE kot_prints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  printed_by INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- A ticket is printed for specific lines; the json column lists order_item ids
  -- so a later "print only the new items" feature does not need a new table.
  item_ids   TEXT    NOT NULL DEFAULT '[]',
  created_at TEXT    NOT NULL
);

CREATE INDEX idx_kot_prints_order ON kot_prints (order_id);
