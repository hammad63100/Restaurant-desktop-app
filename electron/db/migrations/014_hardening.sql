-- 014_hardening.sql
-- Phase 3 hardening.
--
-- The login lockout used to live in a Map inside the main process: closing the app
-- cleared it, so "5 tries, restarts the app, 5 tries again" was unlimited. These
-- columns keep the counter on disk so a restart is not a way around it.

ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- Finding locked accounts without scanning every user (the owner's list view).
CREATE INDEX idx_users_locked_until ON users (locked_until) WHERE locked_until IS NOT NULL;

-- Silent printing: send receipts straight to the default printer instead of opening
-- the system dialog on every sale. Default ON — that dialog is the day-one annoyance
-- at a busy counter — but it can be switched off to change printers.
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('printer_silent', '1', datetime('now', 'localtime'));
