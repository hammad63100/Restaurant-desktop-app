-- 007_settings_extra.sql
-- Document numbering prefixes and other settings used from Phase 3 on.

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('order_prefix',   'ORD', datetime('now', 'localtime')),
  ('invoice_prefix', 'INV', datetime('now', 'localtime')),
  ('low_stock_warn', '1',   datetime('now', 'localtime'));

-- Starting values for document sequences (never reset on a fresh install).
INSERT OR IGNORE INTO number_sequences (name, next_value) VALUES
  ('order',   1),
  ('invoice', 1);
