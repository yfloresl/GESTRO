-- F1b: pedidos del personal y por QR, cocina (KDS), caja y recibos.
ALTER TABLE restaurants ADD COLUMN qr_auto_send BOOLEAN NOT NULL DEFAULT false;   -- false: el mesero confirma el pedido del QR con un toque
ALTER TABLE order_items ADD COLUMN from_qr BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items ADD COLUMN sent_at TIMESTAMPTZ;
ALTER TABLE sales_payments ADD COLUMN customer_name TEXT;
ALTER TABLE sales_payments ADD COLUMN voided_at TIMESTAMPTZ;
ALTER TABLE sales_payments ADD COLUMN voided_by UUID REFERENCES users(id);
ALTER TABLE sales_payments ADD COLUMN void_reason TEXT;
ALTER TABLE sales_payments ADD CONSTRAINT sales_payments_anulacion_con_motivo CHECK (voided_at IS NULL OR void_reason IS NOT NULL);
CREATE INDEX ON order_items(restaurant_id, status);
CREATE INDEX ON order_items(order_id);
-- Una sola caja abierta por cajero.
CREATE UNIQUE INDEX cash_sessions_una_abierta ON cash_sessions(restaurant_id, cashier_id) WHERE closed_at IS NULL;
-- Numeración correlativa de recibos por sucursal, sin saltos ni repetidos (UPDATE ... RETURNING dentro de la transacción).
CREATE TABLE receipt_counters (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id),
  last_number BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE receipt_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receipt_counters USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_counters TO app_user;
