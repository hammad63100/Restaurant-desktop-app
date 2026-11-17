-- 005_orders.sql
-- Customers, orders, order items and invoices.
-- Order items keep a snapshot of name and price so changing a menu price later
-- never changes an old invoice (Rules.md section 2).

CREATE TABLE customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_customers_phone ON customers (phone) WHERE phone <> '';

CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no         TEXT    NOT NULL UNIQUE,
  type             TEXT    NOT NULL CHECK (type IN ('dine_in', 'takeaway', 'delivery')),
  customer_id      INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  customer_name    TEXT    NOT NULL DEFAULT '',
  customer_phone   TEXT    NOT NULL DEFAULT '',
  customer_address TEXT    NOT NULL DEFAULT '',
  waiter_id        INTEGER REFERENCES waiters (id) ON DELETE SET NULL,
  delivery_boy_id  INTEGER REFERENCES delivery_boys (id) ON DELETE SET NULL,
  status           TEXT    NOT NULL CHECK (status IN ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  subtotal         INTEGER NOT NULL CHECK (subtotal >= 0),
  discount         INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_percent      INTEGER NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax              INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total            INTEGER NOT NULL CHECK (total >= 0),
  notes            TEXT    NOT NULL DEFAULT '',
  created_by       INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  cancelled_at     TEXT
);

CREATE INDEX idx_orders_created_at ON orders (created_at);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_type ON orders (type);

CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  name       TEXT    NOT NULL,
  price      INTEGER NOT NULL CHECK (price >= 0),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  notes      TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT    NOT NULL UNIQUE,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  printed_at TEXT,
  created_at TEXT    NOT NULL
);

-- Sequential document numbers (order numbers, invoice numbers) allocated inside
-- the same transaction as the insert so a rollback never burns a number.
CREATE TABLE number_sequences (
  name       TEXT    PRIMARY KEY,
  next_value INTEGER NOT NULL
);
