-- Mientras no exista el Servicio Fiscal SIN, una sucursal nueva opera con recibos (billing_mode = recibo).
ALTER TABLE restaurants ALTER COLUMN billing_mode SET DEFAULT 'recibo';
