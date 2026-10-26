DROP INDEX IF EXISTS reservations_dia;
ALTER TABLE reservations DROP COLUMN created_by, DROP COLUMN created_at, DROP COLUMN code;
ALTER TABLE restaurants DROP COLUMN reservation_max_party, DROP COLUMN reservation_auto_confirm, DROP COLUMN reservation_close,
  DROP COLUMN reservation_open, DROP COLUMN reservation_minutes, DROP COLUMN reservations_enabled;
