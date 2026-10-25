-- F1c: suscripcion y pagos del SaaS (voucher manual), cobro de la plataforma y avisos de vencimiento.
ALTER TABLE subscription_payments ADD COLUMN bank TEXT;
ALTER TABLE subscription_payments ADD COLUMN paid_on DATE;
ALTER TABLE subscription_payments ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE subscription_payments ADD COLUMN expected_amount NUMERIC(12,2);   -- precio del plan por los meses, con descuento de la promocion
ALTER TABLE subscription_payments ADD COLUMN gift_months INT NOT NULL DEFAULT 0;
ALTER TABLE subscription_payments ALTER COLUMN voucher_url DROP NOT NULL;    -- primero se crea el pago y luego se sube la foto
ALTER TABLE saas_promotions ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
-- Avisos de vencimiento ya enviados (uno por sucursal, tipo y dia): evita repetirlos.
CREATE TABLE subscription_notices (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  kind TEXT NOT NULL CHECK (kind IN ('d5','d1','d0')),
  paid_until DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, kind, paid_until)
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_notices TO app_user;
ALTER TABLE subscription_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_notices USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id));
