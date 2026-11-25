-- 004_vehicles.sql
-- Vehicles must exist before delivery_boys, because a rider points at a vehicle.

CREATE TABLE vehicles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  type                TEXT    NOT NULL CHECK (type IN ('bike', 'car', 'other')),
  plate_no            TEXT    NOT NULL UNIQUE,
  model               TEXT    NOT NULL DEFAULT '',
  color               TEXT    NOT NULL DEFAULT '',
  registration_expiry TEXT,
  insurance_expiry    TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

CREATE TABLE vehicle_assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id      INTEGER NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  delivery_boy_id INTEGER NOT NULL,
  from_date       TEXT    NOT NULL,
  to_date         TEXT,
  created_at      TEXT    NOT NULL
);

CREATE INDEX idx_vehicle_assignments_vehicle ON vehicle_assignments (vehicle_id);

CREATE TABLE vehicle_expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('fuel', 'maintenance', 'repair', 'other')),
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  date       TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

CREATE INDEX idx_vehicle_expenses_date ON vehicle_expenses (date);
