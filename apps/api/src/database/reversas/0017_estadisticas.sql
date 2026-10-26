DROP INDEX IF EXISTS sales_payments_fecha;
DROP INDEX IF EXISTS orders_cierre;
ALTER TABLE kpi_daily DROP COLUMN orders_n, DROP COLUMN calculated_at;
