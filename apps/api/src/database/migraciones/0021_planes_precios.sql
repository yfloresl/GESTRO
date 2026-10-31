-- Planes aprobados (precios en dólares; la conversión a Bs usa el tipo de cambio del día, nunca uno fijo) y interruptor de «Planes y precios» en la portada (apagado).
ALTER TABLE plans ADD COLUMN monthly_price_usd NUMERIC(10,2) CHECK (monthly_price_usd >= 0);
ALTER TABLE platform_settings ADD COLUMN show_pricing BOOLEAN NOT NULL DEFAULT false;

UPDATE plans SET monthly_price_usd = 20, features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre"]') WHERE code = 'esencial';
UPDATE plans SET monthly_price_usd = 35, features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas","contabilidad"]') WHERE code = 'profesional';
UPDATE plans SET monthly_price_usd = 60, features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas","contabilidad","sucursales","compras","delivery"]') WHERE code = 'cadena';
