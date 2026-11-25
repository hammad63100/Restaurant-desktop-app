-- 006_staff.sql
-- Waiters, delivery boys, attendance, advances and salary payments.
-- Staff are soft deleted (active = 0) because old orders and salary slips point at them.

CREATE TABLE waiters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL DEFAULT '',
  cnic       TEXT    NOT NULL DEFAULT '',
  address    TEXT    NOT NULL DEFAULT '',
  join_date  TEXT    NOT NULL,
  salary     INTEGER NOT NULL DEFAULT 0 CHECK (salary >= 0),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE delivery_boys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL DEFAULT '',
  cnic       TEXT    NOT NULL DEFAULT '',
  address    TEXT    NOT NULL DEFAULT '',
  join_date  TEXT    NOT NULL,
  salary     INTEGER NOT NULL DEFAULT 0 CHECK (salary >= 0),
  commission INTEGER NOT NULL DEFAULT 0 CHECK (commission >= 0),
  vehicle_id INTEGER REFERENCES vehicles (id) ON DELETE SET NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_type TEXT    NOT NULL CHECK (person_type IN ('waiter', 'delivery_boy')),
  person_id   INTEGER NOT NULL,
  date        TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'leave')),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE (person_type, person_id, date)
);

CREATE TABLE advances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_type TEXT    NOT NULL CHECK (person_type IN ('waiter', 'delivery_boy')),
  person_id   INTEGER NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  date        TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_advances_person ON advances (person_type, person_id, date);

CREATE TABLE salary_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_type TEXT    NOT NULL CHECK (person_type IN ('waiter', 'delivery_boy')),
  person_id   INTEGER NOT NULL,
  month       TEXT    NOT NULL,
  base        INTEGER NOT NULL,
  deductions  INTEGER NOT NULL DEFAULT 0,
  advances    INTEGER NOT NULL DEFAULT 0,
  net         INTEGER NOT NULL,
  paid_on     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE (person_type, person_id, month)
);
