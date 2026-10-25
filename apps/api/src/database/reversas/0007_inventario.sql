DROP TRIGGER IF EXISTS trg_apply_stock_movement ON stock_movements;
DROP FUNCTION IF EXISTS apply_stock_movement();
GRANT INSERT, UPDATE, DELETE ON stock_levels TO app_user;
GRANT UPDATE, DELETE ON stock_movements TO app_user;
DROP INDEX IF EXISTS stock_movements_lote;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_motivo;
ALTER TABLE stock_movements DROP COLUMN reason, DROP COLUMN group_id;
ALTER TABLE ingredients DROP COLUMN active, DROP COLUMN cost_method;
