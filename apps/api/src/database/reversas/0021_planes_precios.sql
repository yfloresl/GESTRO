UPDATE plans SET features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre"]') WHERE code = 'esencial';
UPDATE plans SET features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas"]') WHERE code = 'profesional';
UPDATE plans SET features = jsonb_set(features, '{modulos}', '["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas","sucursales","contabilidad","compras","delivery"]') WHERE code = 'cadena';
ALTER TABLE platform_settings DROP COLUMN show_pricing;
ALTER TABLE plans DROP COLUMN monthly_price_usd;
