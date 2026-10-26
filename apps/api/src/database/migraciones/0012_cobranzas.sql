-- F3b: cuentas por cobrar. Una venta a crédito nace como deuda del cliente; sus cobros se registran contra ella.
ALTER TABLE payables_receivables ADD COLUMN sales_payment_id UUID REFERENCES sales_payments(id);
ALTER TABLE payables_receivables ADD COLUMN customer_phone TEXT;
ALTER TABLE payables_receivables ADD COLUMN voided_at TIMESTAMPTZ;   -- venta anulada: la deuda deja de contar
CREATE UNIQUE INDEX payables_receivables_venta ON payables_receivables(sales_payment_id) WHERE sales_payment_id IS NOT NULL;
