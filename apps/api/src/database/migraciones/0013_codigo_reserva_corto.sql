-- Código de reserva corto y fácil de dictar: 6 caracteres sin letras ni números confundibles (sin 0, 1, I, O), único por sucursal.
CREATE FUNCTION reserva_codigo() RETURNS text LANGUAGE plpgsql AS $$
DECLARE alfabeto CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 símbolos: 256 es múltiplo de 32, sin sesgo
        r text := ''; b bytea := gen_random_bytes(6); i int;
BEGIN
  FOR i IN 0..5 LOOP r := r || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1); END LOOP;
  RETURN r;
END $$;

ALTER TABLE reservations DROP CONSTRAINT reservations_code_key;
ALTER TABLE reservations ALTER COLUMN code SET DEFAULT reserva_codigo();
UPDATE reservations SET code = reserva_codigo();
CREATE UNIQUE INDEX reservations_code_sucursal ON reservations(restaurant_id, code);
