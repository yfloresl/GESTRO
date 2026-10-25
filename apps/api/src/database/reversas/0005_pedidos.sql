DROP TABLE IF EXISTS receipt_counters;
DROP INDEX IF EXISTS cash_sessions_una_abierta;
ALTER TABLE sales_payments DROP CONSTRAINT IF EXISTS sales_payments_anulacion_con_motivo;
ALTER TABLE sales_payments DROP COLUMN customer_name, DROP COLUMN voided_at, DROP COLUMN voided_by, DROP COLUMN void_reason;
ALTER TABLE order_items DROP COLUMN from_qr, DROP COLUMN sent_at;
ALTER TABLE restaurants DROP COLUMN qr_auto_send;
