DROP INDEX IF EXISTS payables_receivables_venta;
ALTER TABLE payables_receivables DROP COLUMN voided_at, DROP COLUMN customer_phone, DROP COLUMN sales_payment_id;
