DROP INDEX IF EXISTS reservations_code_sucursal;
ALTER TABLE reservations ALTER COLUMN code SET DEFAULT encode(gen_random_bytes(8), 'hex');
UPDATE reservations SET code = encode(gen_random_bytes(8), 'hex');
ALTER TABLE reservations ADD CONSTRAINT reservations_code_key UNIQUE (code);
DROP FUNCTION IF EXISTS reserva_codigo();
