-- =====================================================================
-- Sistema de Gestión de Restaurantes (SaaS multi-tenant) · PostgreSQL 16
-- Esquemas: public (restaurante) · fiscal (servicio de facturación SIN)
-- Regla de oro: toda tabla con restaurant_id (o client_app_id) tiene RLS.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- necesaria para EXCLUDE con uuid + rango
CREATE SCHEMA IF NOT EXISTS fiscal;

-- ---------- Tipos ----------
CREATE TYPE staff_kind        AS ENUM ('regular','temporal');
CREATE TYPE order_status      AS ENUM ('borrador','enviado','en_preparacion','listo','servido','cobrado','anulado');
CREATE TYPE order_channel     AS ENUM ('mesero','caja','qr_mesa','web','evento');
CREATE TYPE order_type        AS ENUM ('mesa','mostrador','llevar','delivery');
CREATE TYPE request_kind      AS ENUM ('atencion','cuenta','servicio','otro');
CREATE TYPE request_status    AS ENUM ('pendiente','atendida','cancelada');
CREATE TYPE reservation_state AS ENUM ('pendiente','confirmada','sentada','cumplida','no_show','cancelada');
CREATE TYPE pay_status        AS ENUM ('pendiente','validado','rechazado');
CREATE TYPE doc_kind          AS ENUM ('factura','recibo','ninguno');
CREATE TYPE movement_kind     AS ENUM ('compra','consumo','merma','ajuste','traspaso_in','traspaso_out','produccion');
CREATE TYPE account_type      AS ENUM ('activo','pasivo','patrimonio','ingreso','costo','gasto');
CREATE TYPE invoice_state     AS ENUM ('pendiente','valida','observada','rechazada','anulada','contingencia');

-- =====================================================================
-- PLATAFORMA (Kyros-Tech)
-- =====================================================================
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  monthly_price_bob NUMERIC(12,2) NOT NULL CHECK (monthly_price_bob >= 0),
  features JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE platform_settings (          -- QR de cobro del dueño del SaaS
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payment_qr_url TEXT,
  payment_instructions TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (                   -- empresa/dueño (puede tener varias sucursales)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  nit TEXT,
  owner_email CITEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE restaurants (                -- CADA SUCURSAL ES UN RESTAURANTE (unidad de cobro)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  slug CITEXT UNIQUE NOT NULL,
  is_branch BOOLEAN NOT NULL DEFAULT false,
  city TEXT, address TEXT, timezone TEXT NOT NULL DEFAULT 'America/La_Paz',
  currency CHAR(3) NOT NULL DEFAULT 'BOB',
  billing_mode doc_kind NOT NULL DEFAULT 'factura',   -- factura | recibo | ninguno
  qr_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  plan_id UUID REFERENCES plans(id),
  paid_until DATE,                        -- habilitado hasta esta fecha
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','suspendido','baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON restaurants(account_id);

CREATE TABLE saas_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  months_required INT NOT NULL CHECK (months_required >= 1),
  bonus_months INT NOT NULL DEFAULT 0 CHECK (bonus_months >= 0),
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  CHECK (valid_to >= valid_from)
);

CREATE TABLE subscription_payments (      -- voucher subido por el restaurante
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  months_paid INT NOT NULL CHECK (months_paid BETWEEN 1 AND 24),
  amount_bob NUMERIC(12,2) NOT NULL CHECK (amount_bob > 0),
  voucher_url TEXT NOT NULL,
  promotion_id UUID REFERENCES saas_promotions(id),
  ocr_extract JSONB,                      -- sugerencia IA (monto, fecha, banco, referencia)
  bank_reference TEXT,
  status pay_status NOT NULL DEFAULT 'pendiente',
  validated_by UUID,                      -- admin / encargado de cobranzas / Kyros
  validated_at TIMESTAMPTZ,
  period_from DATE, period_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON subscription_payments(bank_reference) WHERE bank_reference IS NOT NULL AND status <> 'rechazado';

-- =====================================================================
-- SEGURIDAD Y USUARIOS
-- =====================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id),    -- NULL = personal de plataforma Kyros
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  mfa_secret TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,                 -- owner, admin, cobranzas, cajero, mesero, area_manager, cocina, almacen, contador
  description TEXT,
  permissions TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE user_roles (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  PRIMARY KEY (restaurant_id, user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants(id),
  user_id UUID, action TEXT NOT NULL, entity TEXT, entity_id TEXT,
  before JSONB, after JSONB, ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- PERSONAL
-- =====================================================================
CREATE TABLE staff_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, description TEXT,
  UNIQUE (restaurant_id, name)
);

CREATE TABLE staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  user_id UUID REFERENCES users(id),
  full_name TEXT NOT NULL, document_id TEXT, phone TEXT,
  kind staff_kind NOT NULL DEFAULT 'regular',
  function_id UUID REFERENCES staff_functions(id),
  hourly_cost NUMERIC(10,2), monthly_salary NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  staff_id UUID NOT NULL REFERENCES staff_members(id),
  function_id UUID REFERENCES staff_functions(id),
  event_id UUID,                               -- FK abajo (events)
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  check_in TIMESTAMPTZ, check_out TIMESTAMPTZ,
  pay_amount NUMERIC(12,2),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
);

-- =====================================================================
-- SALÓN: ÁREAS, MESAS, ASIGNACIÓN, SOLICITUDES QR
-- =====================================================================
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  manager_staff_id UUID REFERENCES staff_members(id),
  UNIQUE (restaurant_id, name)
);

CREATE TABLE restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  area_id UUID REFERENCES areas(id),
  number TEXT NOT NULL,
  seats INT NOT NULL CHECK (seats > 0),
  qr_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(18),'hex'),
  pos_x INT, pos_y INT,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, number)
);

CREATE TABLE table_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  table_id UUID NOT NULL REFERENCES restaurant_tables(id),
  waiter_id UUID NOT NULL REFERENCES staff_members(id),
  valid_during TSTZRANGE NOT NULL,
  EXCLUDE USING gist (table_id WITH =, valid_during WITH &&)
);

CREATE TABLE service_requests (            -- llamado/cuenta/servicio desde el QR de mesa
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  table_id UUID NOT NULL REFERENCES restaurant_tables(id),
  kind request_kind NOT NULL,
  comment TEXT CHECK (char_length(comment) <= 300),
  status request_status NOT NULL DEFAULT 'pendiente',
  assigned_waiter_id UUID REFERENCES staff_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended_at TIMESTAMPTZ
);
CREATE INDEX ON service_requests(restaurant_id, status, created_at);

-- =====================================================================
-- MENÚ, PROMOCIONES
-- =====================================================================
CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  category_id UUID REFERENCES menu_categories(id),
  name TEXT NOT NULL, description TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  photo_url TEXT,
  allergens TEXT[] NOT NULL DEFAULT '{}',
  prep_minutes INT,
  sin_product_code TEXT,                      -- código de producto SIN (catálogo)
  available BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('hora','dia','semana','mes','anio','rango')),
  discount_pct NUMERIC(5,2) CHECK (discount_pct BETWEEN 0 AND 100),
  fixed_price NUMERIC(12,2),
  valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ NOT NULL,
  weekdays SMALLINT[] , start_time TIME, end_time TIME,
  item_ids UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  CHECK (valid_to > valid_from)
);

-- =====================================================================
-- PEDIDOS Y COBROS
-- =====================================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  table_id UUID REFERENCES restaurant_tables(id),
  waiter_id UUID REFERENCES staff_members(id),
  channel order_channel NOT NULL DEFAULT 'mesero',
  order_type order_type NOT NULL DEFAULT 'mesa',   -- mesa | mostrador | llevar | delivery
  ticket_number INT,                                -- correlativo por día y sucursal (ver order_counters)
  customer_name TEXT, customer_phone TEXT,          -- para llevar / delivery
  delivery_address TEXT,
  pickup_at TIMESTAMPTZ,                            -- hora prometida de entrega o recojo
  created_by UUID REFERENCES users(id),             -- quién tomó el pedido
  status order_status NOT NULL DEFAULT 'borrador',
  customer_comment TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ, ready_at TIMESTAMPTZ, closed_at TIMESTAMPTZ,
  CHECK (order_type <> 'mesa' OR table_id IS NOT NULL),
  CHECK (order_type <> 'delivery' OR (delivery_address IS NOT NULL AND customer_phone IS NOT NULL))
);
CREATE INDEX ON orders(restaurant_id, status, opened_at);
CREATE UNIQUE INDEX orders_ticket_uq ON orders(restaurant_id, ((opened_at AT TIME ZONE 'America/La_Paz')::date), ticket_number)
  WHERE ticket_number IS NOT NULL;

CREATE TABLE order_counters (                       -- numeración diaria de tickets por sucursal
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  day DATE NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, day)
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  qty NUMERIC(8,2) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  note TEXT,
  modifiers JSONB NOT NULL DEFAULT '[]',            -- ej. sin cebolla, punto de cocción, extra queso
  course SMALLINT NOT NULL DEFAULT 1,               -- tiempo: 1 entrada, 2 fondo, 3 postre
  status order_status NOT NULL DEFAULT 'enviado',
  started_at TIMESTAMPTZ, ready_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ, voided_by UUID REFERENCES users(id), void_reason TEXT,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE TABLE cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  cashier_id UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ,
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  counted_amount NUMERIC(12,2)
);

CREATE TABLE sales_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  cash_session_id UUID REFERENCES cash_sessions(id),
  method TEXT NOT NULL CHECK (method IN ('efectivo','qr','tarjeta','transferencia','credito')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  document doc_kind NOT NULL DEFAULT 'factura',
  fiscal_invoice_id UUID,                      -- referencia lógica al servicio fiscal
  receipt_number BIGINT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE receipts (                       -- recibos (régimen sin factura)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  number BIGINT NOT NULL,
  order_id UUID REFERENCES orders(id),
  customer_name TEXT, amount NUMERIC(12,2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, number)
);

-- =====================================================================
-- RESERVAS (sin solapamiento por mesa)
-- =====================================================================
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  table_id UUID REFERENCES restaurant_tables(id),
  customer_name TEXT NOT NULL, phone TEXT, email CITEXT,
  party_size INT NOT NULL CHECK (party_size > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  state reservation_state NOT NULL DEFAULT 'pendiente',
  notes TEXT, source TEXT NOT NULL DEFAULT 'web',
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (table_id IS NOT NULL AND state IN ('pendiente','confirmada','sentada'))
);

-- =====================================================================
-- EVENTOS Y CATERING
-- =====================================================================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('evento','catering','buffet','privado')),
  client_name TEXT, client_phone TEXT,
  guests INT NOT NULL CHECK (guests > 0),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  price_total NUMERIC(12,2), deposit NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'cotizado' CHECK (status IN ('cotizado','confirmado','en_curso','cerrado','cancelado')),
  CHECK (ends_at > starts_at)
);
ALTER TABLE shifts ADD CONSTRAINT shifts_event_fk FOREIGN KEY (event_id) REFERENCES events(id);

CREATE TABLE event_menu (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  portions INT NOT NULL CHECK (portions > 0),
  PRIMARY KEY (event_id, menu_item_id)
);

-- =====================================================================
-- INVENTARIO, RECETAS, PRODUCCIÓN, COMPRAS
-- =====================================================================
CREATE TABLE units (
  code TEXT PRIMARY KEY,                      -- kg, g, l, ml, un
  base_code TEXT REFERENCES units(code),
  factor_to_base NUMERIC(14,6) NOT NULL DEFAULT 1
);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, UNIQUE (restaurant_id, name)
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, nit TEXT, phone TEXT, lead_days INT DEFAULT 1
);

CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, category TEXT,
  unit_code TEXT NOT NULL REFERENCES units(code),
  min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  last_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  perishable BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, name)
);

CREATE TABLE stock_levels (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  avg_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id, ingredient_id)
);

CREATE TABLE stock_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  kind movement_kind NOT NULL,
  qty NUMERIC(14,3) NOT NULL,                 -- + entra / - sale
  unit_cost NUMERIC(14,4),
  ref_type TEXT, ref_id UUID,
  lot TEXT, expires_on DATE,
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON stock_movements(restaurant_id, ingredient_id, created_at);

CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  version INT NOT NULL DEFAULT 1,
  yield_portions NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (yield_portions > 0),
  instructions TEXT,
  waste_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (menu_item_id, version)
);

CREATE TABLE recipe_lines (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  qty NUMERIC(14,4) NOT NULL CHECK (qty > 0),
  unit_code TEXT NOT NULL REFERENCES units(code),
  PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE TABLE production_plans (             -- "platos del día" → insumos requeridos
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  plan_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ia','evento')),
  UNIQUE (restaurant_id, plan_date, source)
);

CREATE TABLE production_plan_items (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  portions INT NOT NULL CHECK (portions > 0),
  PRIMARY KEY (plan_id, menu_item_id)
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','enviada','recibida','cancelada')),
  expected_on DATE, total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_lines (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(14,4) NOT NULL,
  PRIMARY KEY (purchase_order_id, ingredient_id)
);

-- =====================================================================
-- CONTABILIDAD (nivel medio)
-- =====================================================================
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  type account_type NOT NULL,
  parent_id UUID REFERENCES chart_of_accounts(id),
  accepts_entries BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, code)
);

CREATE TABLE cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (restaurant_id, code)
);

CREATE TABLE fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  year INT NOT NULL, month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  closed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, year, month)
);

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  entry_date DATE NOT NULL,
  number BIGINT NOT NULL,
  memo TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',      -- venta, compra, nomina, ajuste, ...
  source_id UUID,
  posted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, number)
);

CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0))
);

-- Partida doble: un asiento solo puede publicarse si debe = haber.
CREATE FUNCTION trg_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d NUMERIC; c NUMERIC;
BEGIN
  IF NEW.posted AND NOT COALESCE(OLD.posted,false) THEN
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
      FROM journal_lines WHERE entry_id = NEW.id;
    IF d <> c OR d = 0 THEN
      RAISE EXCEPTION 'Asiento % descuadrado (debe %, haber %)', NEW.number, d, c;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_balanced BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_entry_balanced();

CREATE TABLE payables_receivables (         -- deudas por pagar / por cobrar
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  direction TEXT NOT NULL CHECK (direction IN ('por_pagar','por_cobrar')),
  counterparty TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due_on DATE NOT NULL,
  CHECK (paid <= amount)
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  account_id UUID REFERENCES chart_of_accounts(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  supplier_id UUID REFERENCES suppliers(id),
  description TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  document_number TEXT, spent_on DATE NOT NULL,
  attachment_url TEXT
);

-- =====================================================================
-- ANALÍTICA, ALERTAS, FODA, IA
-- =====================================================================
CREATE TABLE kpi_daily (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  day DATE NOT NULL,
  revenue NUMERIC(14,2), costs NUMERIC(14,2), covers INT,
  avg_ticket NUMERIC(12,2), avg_prep_minutes NUMERIC(8,2),
  food_cost_pct NUMERIC(6,2), waste_value NUMERIC(12,2),
  PRIMARY KEY (restaurant_id, day)
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  kind TEXT NOT NULL,                         -- demora_cocina, stock_bajo, merma_alta, ...
  severity TEXT NOT NULL CHECK (severity IN ('info','media','alta')),
  message TEXT NOT NULL, data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);

CREATE TABLE swot_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  period_from DATE NOT NULL, period_to DATE NOT NULL,
  strengths JSONB, weaknesses JSONB, opportunities JSONB, threats JSONB,
  evidence JSONB,                             -- métricas que sustentan cada punto
  model TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  task TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INT, output_tokens INT, cost_usd NUMERIC(10,5),
  status TEXT NOT NULL DEFAULT 'ok', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- SERVICIO FISCAL SIN (esquema fiscal) - reutilizable por otras apps
-- =====================================================================
CREATE TABLE fiscal.client_apps (           -- cada aplicación de Kyros (o cliente externo)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT UNIQUE NOT NULL,
  webhook_url TEXT,
  environment TEXT NOT NULL DEFAULT 'piloto' CHECK (environment IN ('piloto','produccion')),
  active BOOLEAN NOT NULL DEFAULT true,
  monthly_invoice_quota INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fiscal.taxpayers (             -- contribuyente emisor
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  external_ref TEXT NOT NULL,                 -- id del restaurante/cliente en la app
  nit TEXT NOT NULL, legal_name TEXT NOT NULL,
  modality TEXT NOT NULL CHECK (modality IN ('electronica_en_linea','computarizada_en_linea')),
  system_code TEXT,                           -- código de sistema autorizado por el SIN
  UNIQUE (client_app_id, external_ref),
  UNIQUE (client_app_id, nit)
);

CREATE TABLE fiscal.certificates (          -- firma digital (clave cifrada, nunca en claro)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  taxpayer_id UUID NOT NULL REFERENCES fiscal.taxpayers(id),
  cert_pem TEXT NOT NULL,
  key_ciphertext BYTEA NOT NULL,              -- cifrada con KMS / clave maestra
  not_after TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE fiscal.branches_pos (          -- sucursal SIN + punto de venta
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  taxpayer_id UUID NOT NULL REFERENCES fiscal.taxpayers(id),
  branch_code INT NOT NULL, pos_code INT NOT NULL DEFAULT 0,
  address TEXT, municipality TEXT,
  UNIQUE (taxpayer_id, branch_code, pos_code)
);

CREATE TABLE fiscal.cuis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  branch_pos_id UUID NOT NULL REFERENCES fiscal.branches_pos(id),
  code TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ NOT NULL
);

CREATE TABLE fiscal.cufd (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  branch_pos_id UUID NOT NULL REFERENCES fiscal.branches_pos(id),
  code TEXT NOT NULL, control_code TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ NOT NULL,
  EXCLUDE USING gist (branch_pos_id WITH =, tstzrange(valid_from, valid_to) WITH &&)
);

CREATE TABLE fiscal.catalogs (              -- paramétricas sincronizadas del SIN
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  catalog TEXT NOT NULL,                      -- actividades, productos_servicios, unidades, monedas, metodos_pago, tipos_documento, leyendas, motivos_anulacion, eventos_significativos
  code TEXT NOT NULL, description TEXT, synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_app_id, catalog, code)
);

CREATE TABLE fiscal.invoice_sequences (
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  branch_pos_id UUID NOT NULL REFERENCES fiscal.branches_pos(id),
  last_number BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_pos_id)
);

CREATE TABLE fiscal.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  taxpayer_id UUID NOT NULL REFERENCES fiscal.taxpayers(id),
  branch_pos_id UUID NOT NULL REFERENCES fiscal.branches_pos(id),
  idempotency_key TEXT NOT NULL,
  sector_document INT NOT NULL DEFAULT 1,     -- 1 = compra y venta
  number BIGINT NOT NULL,
  cuf TEXT UNIQUE,
  cufd_id UUID REFERENCES fiscal.cufd(id),
  issued_at TIMESTAMPTZ NOT NULL,
  buyer_doc_type INT, buyer_doc_number TEXT, buyer_name TEXT, buyer_email CITEXT,
  total NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  payment_method INT NOT NULL,
  state invoice_state NOT NULL DEFAULT 'pendiente',
  emission_type INT NOT NULL DEFAULT 1,       -- 1 en línea, 2 contingencia
  reception_code TEXT,
  xml_signed BYTEA,
  sin_messages JSONB,
  cancel_reason_code INT, cancelled_at TIMESTAMPTZ,
  UNIQUE (client_app_id, idempotency_key),
  UNIQUE (branch_pos_id, number)
);
CREATE INDEX ON fiscal.invoices(client_app_id, taxpayer_id, issued_at);

CREATE TABLE fiscal.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  invoice_id UUID NOT NULL REFERENCES fiscal.invoices(id) ON DELETE CASCADE,
  economic_activity TEXT NOT NULL, sin_product_code TEXT NOT NULL,
  description TEXT NOT NULL, qty NUMERIC(14,4) NOT NULL CHECK (qty > 0),
  unit_code INT NOT NULL, unit_price NUMERIC(14,4) NOT NULL,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0, subtotal NUMERIC(14,2) NOT NULL
);

CREATE TABLE fiscal.significant_events (    -- cortes de internet, caída del SIN, etc.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  branch_pos_id UUID NOT NULL REFERENCES fiscal.branches_pos(id),
  event_code INT NOT NULL, description TEXT,
  started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
  cufd_event_id UUID REFERENCES fiscal.cufd(id),
  sin_event_id TEXT, registered_at TIMESTAMPTZ
);

CREATE TABLE fiscal.contingency_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  event_id UUID NOT NULL REFERENCES fiscal.significant_events(id),
  invoice_count INT NOT NULL, package_hash TEXT NOT NULL,
  sent_at TIMESTAMPTZ, reception_code TEXT, state TEXT NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE fiscal.sin_calls (             -- bitácora de cada llamada al SIN
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_app_id UUID NOT NULL REFERENCES fiscal.client_apps(id),
  service TEXT NOT NULL, operation TEXT NOT NULL,
  request_hash TEXT, http_status INT, ok BOOLEAN,
  duration_ms INT, called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- ROW LEVEL SECURITY — generado para TODAS las tablas con tenant
-- =====================================================================
CREATE FUNCTION app_restaurant_ok(rid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_platform', true) = 'on'
      OR rid = NULLIF(current_setting('app.restaurant_id', true), '')::uuid
      OR rid = ANY (string_to_array(NULLIF(current_setting('app.restaurant_ids', true), ''), ',')::uuid[])
$$;

CREATE FUNCTION fiscal.app_client_ok(cid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_platform', true) = 'on'
      OR cid = NULLIF(current_setting('app.client_app_id', true), '')::uuid
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT table_schema AS s, table_name AS t, column_name AS c
           FROM information_schema.columns
           WHERE table_schema IN ('public','fiscal')
             AND column_name IN ('restaurant_id','client_app_id')
             AND table_name NOT IN ('restaurants','client_apps')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
    IF r.c = 'restaurant_id' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id))', r.s, r.t);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (fiscal.app_client_ok(client_app_id)) WITH CHECK (fiscal.app_client_ok(client_app_id))', r.s, r.t);
    END IF;
  END LOOP;
END $$;

-- restaurants se protege por su propio id
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurants USING (app_restaurant_ok(id)) WITH CHECK (app_restaurant_ok(id));

-- Rol de aplicación SIN privilegio BYPASSRLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public, fiscal TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, fiscal TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public, fiscal TO app_user;
