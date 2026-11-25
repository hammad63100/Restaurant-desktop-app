-- 017_cash_purchase_link.sql
-- Roadmap 4.B follow-up: tie a drawer movement to the purchase that caused it.
--
-- A cash purchase writes an `expense` row into cash_movements. Without a link,
-- voiding that purchase can only guess which row to reverse — and guessing with
-- the shop's cash is not acceptable. The column also lets the day-close screen
-- show "Purchase PUR-00003" instead of a free-text string nobody can check.
--
-- SQLite cannot ADD COLUMN with a REFERENCES clause onto a table that already has
-- rows unless the default is NULL, which is exactly what is needed here, so the
-- plain `ALTER TABLE` form works.

ALTER TABLE cash_movements ADD COLUMN ref_purchase_id INTEGER;

CREATE INDEX idx_cash_movements_purchase ON cash_movements (ref_purchase_id);
