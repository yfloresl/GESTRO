-- Modo QA de la sucursal de demostración: con TRUE (por defecto) las cuentas demo ejecutan las acciones de su rol sobre su propio espacio;
-- con FALSE vuelve a ser de solo lectura. Lo cambia plataforma (auditado). Aditiva.
ALTER TABLE restaurants ADD COLUMN demo_writable BOOLEAN NOT NULL DEFAULT true;
