-- Facturación del restaurante a sus comensales a través de FacturaSIN (Flujo 2, ambiente de pruebas).
-- Aditiva y reversible: tablas nuevas y dos columnas opcionales en menu_items. Nada se borra ni se reescribe.
-- Los secretos (token delegado, secretos de webhook) NO van en estas tablas: se guardan cifrados en app_config.

CREATE TABLE billing_settings (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id),
  nit TEXT NOT NULL CHECK (nit ~ '^[0-9]{5,13}$'),
  legal_name TEXT NOT NULL CHECK (length(btrim(legal_name)) >= 2),
  economic_activities TEXT[] NOT NULL CHECK (cardinality(economic_activities) >= 1),
  branch_code INT NOT NULL DEFAULT 0 CHECK (branch_code >= 0),
  pos_code INT NOT NULL DEFAULT 0 CHECK (pos_code >= 0),
  municipality TEXT NOT NULL CHECK (length(btrim(municipality)) >= 2),
  address TEXT NOT NULL CHECK (length(btrim(address)) >= 3),
  legend TEXT,
  mode TEXT NOT NULL DEFAULT 'simulado' CHECK (mode IN ('simulado','real')),
  default_sin_product_code TEXT NOT NULL,
  default_unit_code SMALLINT NOT NULL DEFAULT 57,
  allow_final_consumer BOOLEAN NOT NULL DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  token_set BOOLEAN NOT NULL DEFAULT false,
  token_expires_on DATE,
  token_updated_at TIMESTAMPTZ,
  webhook_set BOOLEAN NOT NULL DEFAULT false,
  webhook_updated_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE fiscal_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id UUID NOT NULL REFERENCES sales_payments(id),
  attempt INT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  external_id TEXT NOT NULL,                       -- gestro:<pedido>:<intento>; también es la Idempotency-Key
  status TEXT NOT NULL DEFAULT 'en_cola' CHECK (status IN ('en_cola','pendiente','validada','observada','contingencia','rechazada','error_datos','anulada')),
  buyer_doc_type SMALLINT NOT NULL CHECK (buyer_doc_type BETWEEN 1 AND 5),
  buyer_doc_number TEXT NOT NULL,
  buyer_complement TEXT,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  buyer_exception SMALLINT NOT NULL DEFAULT 0 CHECK (buyer_exception IN (0,1)),
  final_consumer BOOLEAN NOT NULL DEFAULT false,
  subtotal NUMERIC(14,2) NOT NULL,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL CHECK (total > 0),
  iva_ref NUMERIC(14,2) NOT NULL,                  -- 13 % del importe facturado, calculado en GESTRO y contrastado con FacturaSIN
  tip_excluded NUMERIC(14,2) NOT NULL DEFAULT 0,   -- la propina nunca se factura
  payload JSONB NOT NULL,                          -- lo que se envía a FacturaSIN: idéntico en cada reintento
  fs_invoice_id TEXT,
  invoice_number BIGINT,
  cuf TEXT,
  issued_at TIMESTAMPTZ,
  fs_total NUMERIC(14,2),
  fs_iva NUMERIC(14,2),
  links JSONB,
  qr_text TEXT,
  notice TEXT,
  test_env BOOLEAN NOT NULL DEFAULT true,
  errors JSONB,
  last_error TEXT,
  tries INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_try_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  void_code SMALLINT,
  void_reason TEXT,
  voided_by UUID REFERENCES users(id),
  voided_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un pedido tiene a lo sumo UNA factura viva; las rechazadas o anuladas se pueden reemitir con otro intento.
CREATE UNIQUE INDEX fiscal_invoices_viva ON fiscal_invoices(order_id) WHERE status IN ('en_cola','pendiente','validada','observada','contingencia');
CREATE UNIQUE INDEX fiscal_invoices_externo ON fiscal_invoices(restaurant_id, external_id);
CREATE INDEX fiscal_invoices_cola ON fiscal_invoices(next_retry_at) WHERE status = 'en_cola';
CREATE INDEX fiscal_invoices_lista ON fiscal_invoices(restaurant_id, created_at DESC);

CREATE TABLE fiscal_webhook_events (
  event_id TEXT NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  kind TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, event_id)
);

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sin_unit_code SMALLINT CHECK (sin_unit_code IS NULL OR sin_unit_code > 0);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_settings','fiscal_invoices','fiscal_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
  END LOOP;
END $$;
