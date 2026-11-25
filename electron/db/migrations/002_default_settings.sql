-- 002_default_settings.sql
-- Default shop settings. INSERT OR IGNORE keeps this safe if a key already exists.

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('shop_name',        'Gul Khan Fast Food', datetime('now', 'localtime')),
  ('shop_address',     '',                   datetime('now', 'localtime')),
  ('shop_phone',       '',                   datetime('now', 'localtime')),
  ('shop_logo',        '',                   datetime('now', 'localtime')),
  ('currency',         'PKR',                datetime('now', 'localtime')),
  ('tax_percent',      '0',                  datetime('now', 'localtime')),
  ('receipt_width',    '80mm',               datetime('now', 'localtime')),
  ('backup_on_close',  '1',                  datetime('now', 'localtime'));
