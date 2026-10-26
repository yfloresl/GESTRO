ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_costos_validos;
DROP INDEX IF EXISTS shifts_evento;
DROP INDEX IF EXISTS shifts_fecha;
ALTER TABLE shifts DROP COLUMN created_by, DROP COLUMN notes;
