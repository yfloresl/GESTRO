-- Flujo 1 de facturacion: Kyros-Tech factura a sus clientes (restaurantes) por la suscripcion, via FacturaSIN.
-- Aditiva y reversible. Nada se borra: un pago validado puede tener a lo sumo una fila de factura (con su historial de intentos).

-- Datos fiscales del cliente (la cuenta/titular). accounts.legal_name es la razon social y accounts.nit el numero de documento.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fiscal_doc_type TEXT NOT NULL DEFAULT 'NIT' CHECK (fiscal_doc_type IN ('NIT','CI','CEX','PAS'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fiscal_doc_complement TEXT CHECK (fiscal_doc_complement IS NULL OR fiscal_doc_complement ~ '^[0-9A-Za-z]{1,5}$');
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fiscal_email TEXT;

CREATE TABLE IF NOT EXISTS kyros_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES subscription_payments(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  -- pendiente: aun sin emitir (sin datos fiscales, FacturaSIN caido, rechazo de validacion); emitiendo: llamada en curso;
  -- en_proceso: FacturaSIN la acepto pero el SIN no confirmo (pendiente/contingencia); emitida: validada; observada; rechazada; anulada.
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','emitiendo','en_proceso','emitida','observada','rechazada','anulada')),
  attempts INT NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  total_bob_cent BIGINT NOT NULL CHECK (total_bob_cent > 0),
  iva_bob_cent BIGINT NOT NULL CHECK (iva_bob_cent >= 0),
  iva_fs_cent BIGINT,                       -- IVA que devolvio FacturaSIN (control cruzado)
  buyer_doc_type TEXT NOT NULL, buyer_doc_number TEXT NOT NULL, buyer_doc_complement TEXT, buyer_name TEXT NOT NULL, buyer_email TEXT,
  buyer_fallback BOOLEAN NOT NULL DEFAULT false,   -- consumidor final / sin nombre (el cliente no tenia datos fiscales)
  description TEXT NOT NULL,
  fx_usd_bob NUMERIC(14,6), fx_fecha DATE,         -- TCO con el que se calculo el precio, copiado del pago
  facturasin_id TEXT, cuf TEXT, invoice_number BIGINT, qr_text TEXT,
  test_environment BOOLEAN NOT NULL DEFAULT true,  -- FacturaSIN devolvio ambientePruebas (simulada, sin validez fiscal)
  fiscal_notice TEXT,
  last_error_code TEXT, last_error TEXT, retryable BOOLEAN NOT NULL DEFAULT true,
  last_attempt_at TIMESTAMPTZ, emitted_at TIMESTAMPTZ,
  void_reason_code SMALLINT, void_comment TEXT, voided_at TIMESTAMPTZ, voided_by UUID,
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyros_invoices_status_idx ON kyros_invoices (status, last_attempt_at);
CREATE INDEX IF NOT EXISTS kyros_invoices_restaurant_idx ON kyros_invoices (restaurant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kyros_invoices_fs_idx ON kyros_invoices (facturasin_id) WHERE facturasin_id IS NOT NULL;

-- Eventos de webhook ya procesados (X-FacturaSIN-Event-Id es idempotente: puede llegar mas de una vez).
CREATE TABLE IF NOT EXISTS kyros_invoice_events (
  event_id TEXT PRIMARY KEY,
  invoice_id UUID REFERENCES kyros_invoices(id),
  kind TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El restaurante solo ve SUS facturas (RLS por sucursal, igual que el resto); la consola de plataforma usa la conexion de dueño.
GRANT SELECT ON kyros_invoices TO app_user;
ALTER TABLE kyros_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyros_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kyros_invoices USING (app_restaurant_ok(restaurant_id));
