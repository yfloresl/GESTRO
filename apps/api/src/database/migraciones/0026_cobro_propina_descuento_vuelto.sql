-- GST-004: el cobro registra propina, descuento (con motivo), efectivo recibido y vuelto. Aditiva: todo con valor por defecto.
ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0);
ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS cash_received NUMERIC(12,2) CHECK (cash_received >= 0);
ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS change_given NUMERIC(12,2) CHECK (change_given >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_reason TEXT;
