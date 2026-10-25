-- F2c: proveedores, órdenes de compra con recepción parcial, historial de precios y cuentas por pagar.

ALTER TABLE suppliers ADD COLUMN email TEXT;
ALTER TABLE suppliers ADD COLUMN payment_days INT NOT NULL DEFAULT 0 CHECK (payment_days BETWEEN 0 AND 365);   -- plazo de crédito
ALTER TABLE suppliers ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX suppliers_nombre ON suppliers(restaurant_id, lower(name));

-- Proveedor preferido del insumo (para agrupar las órdenes sugeridas) y almacén de donde se consume al vender.
ALTER TABLE ingredients ADD COLUMN preferred_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE ingredients ADD COLUMN default_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('borrador','enviada','parcial','recibida','cancelada'));
ALTER TABLE purchase_orders ADD COLUMN notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN sent_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN plan_date DATE;                       -- si nació de un plan del día
ALTER TABLE purchase_order_lines ADD COLUMN received_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0);

-- Cada recepción queda registrada con lo pedido y lo recibido: las diferencias no se pierden.
CREATE TABLE purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  invoice_number TEXT, notes TEXT,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE purchase_receipt_lines (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  receipt_id UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  ordered_qty NUMERIC(14,3) NOT NULL, pending_before NUMERIC(14,3) NOT NULL, received_qty NUMERIC(14,3) NOT NULL CHECK (received_qty > 0),
  unit_cost NUMERIC(14,4) NOT NULL,
  PRIMARY KEY (receipt_id, ingredient_id)
);

-- Historial de precios por proveedor (alimenta la comparación y la alerta de alza).
CREATE TABLE supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  unit_cost NUMERIC(14,4) NOT NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX supplier_prices_idx ON supplier_prices(restaurant_id, ingredient_id, supplier_id, recorded_at DESC);

ALTER TABLE payables_receivables ADD COLUMN purchase_order_id UUID REFERENCES purchase_orders(id);
ALTER TABLE payables_receivables ADD COLUMN receipt_id UUID REFERENCES purchase_receipts(id);
ALTER TABLE payables_receivables ADD COLUMN document_number TEXT;
ALTER TABLE payables_receivables ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payables_receivables ADD COLUMN paid_at TIMESTAMPTZ;
ALTER TABLE payables_receivables ADD COLUMN paid_by UUID REFERENCES users(id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_receipts','purchase_receipt_lines','supplier_prices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
