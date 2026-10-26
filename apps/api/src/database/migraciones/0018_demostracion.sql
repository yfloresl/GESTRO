-- Cuentas de demostración del ecosistema Kyros (Prueba_Kyros): una sola sucursal de muestra, de solo lectura, que se restablece sola.
ALTER TABLE restaurants ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE restaurants ADD COLUMN demo_reset_at TIMESTAMPTZ;
ALTER TABLE restaurants ADD COLUMN demo_days INT NOT NULL DEFAULT 60 CHECK (demo_days BETWEEN 7 AND 90);   -- días de historia que se recargan al restablecer
CREATE UNIQUE INDEX restaurants_una_demostracion ON restaurants((true)) WHERE is_demo;
