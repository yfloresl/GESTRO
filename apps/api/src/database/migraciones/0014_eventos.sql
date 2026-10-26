-- F4b: eventos y catering. Cotización con costo de recetas, anticipos y saldo, consumo de insumos al iniciar y reconocimiento del ingreso al cerrar.
ALTER TABLE events ADD COLUMN notes TEXT;
ALTER TABLE events ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE events ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE events ADD COLUMN consumed_at TIMESTAMPTZ;   -- los insumos del menú ya salieron del inventario (una sola vez)
ALTER TABLE events ADD COLUMN closed_at TIMESTAMPTZ;
CREATE INDEX events_fecha ON events(restaurant_id, starts_at);

CREATE TABLE event_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  event_id UUID NOT NULL REFERENCES events(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  kind TEXT NOT NULL CHECK (kind IN ('anticipo','saldo')),
  via TEXT NOT NULL CHECK (via IN ('caja','bancos')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ                      -- evento cancelado con devolución: el cobro queda anulado, no se borra
);
CREATE INDEX event_payments_evento ON event_payments(event_id);

ALTER TABLE payables_receivables ADD COLUMN event_id UUID REFERENCES events(id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

-- Cuenta «Anticipos de clientes» (pasivo) para los planes de cuentas que ya existen; las sucursales nuevas la traen en la plantilla.
INSERT INTO chart_of_accounts (restaurant_id, code, name, type, parent_id, accepts_entries, system_key)
SELECT p.restaurant_id, '2.1.04', 'Anticipos de clientes', 'pasivo', p.id, true, 'anticipos'
FROM chart_of_accounts p
WHERE p.code = '2.1' AND NOT EXISTS (SELECT 1 FROM chart_of_accounts x WHERE x.restaurant_id = p.restaurant_id AND (x.system_key = 'anticipos' OR x.code = '2.1.04'));
