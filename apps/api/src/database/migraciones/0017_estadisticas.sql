-- F5a: estadísticas. Los indicadores diarios se precalculan en kpi_daily (trabajo nocturno y a pedido).
ALTER TABLE kpi_daily ADD COLUMN calculated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE kpi_daily ADD COLUMN orders_n INT NOT NULL DEFAULT 0;           -- pedidos cobrados (no son comensales: el sistema no los cuenta)
CREATE INDEX orders_cierre ON orders(restaurant_id, closed_at) WHERE status = 'cobrado';
CREATE INDEX sales_payments_fecha ON sales_payments(restaurant_id, paid_at) WHERE voided_at IS NULL;
