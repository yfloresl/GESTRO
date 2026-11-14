-- GST-001: cada cobro (total o parcial) de una cuenta por cobrar queda registrado, con la caja del cajero que recibió el efectivo.
-- Así el arqueo de cierre incluye el efectivo cobrado a clientes de crédito. Aditiva.
CREATE TABLE receivable_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  receivable_id UUID NOT NULL REFERENCES payables_receivables(id),
  cash_session_id UUID REFERENCES cash_sessions(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  via TEXT NOT NULL CHECK (via IN ('caja','bancos')),
  collected_by UUID REFERENCES users(id),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receivable_collections_caja ON receivable_collections(cash_session_id) WHERE cash_session_id IS NOT NULL;
ALTER TABLE receivable_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receivable_collections USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON receivable_collections TO app_user;
