-- Paquetes por módulo (catálogo). Los entitlements NO se aplican hasta que plataforma ponga features.aplicar = true.
-- Precios iniciales en Bs (históricos; el cobro de planes con precio en USD usa el TCO del día, ver 0029 y 0021). Solo se crean los planes que no existan; no se tocan los existentes.
INSERT INTO plans (code, name, monthly_price_bob, features) VALUES
  ('esencial',    'Esencial',    174.00, '{"aplicar":false,"modulos":["menu_salon","caja","cierre"]}'),
  ('profesional', 'Profesional', 341.04, '{"aplicar":false,"modulos":["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas"]}'),
  ('cadena',      'Cadena',      689.04, '{"aplicar":false,"modulos":["menu_salon","caja","cierre","cocina","inventario","reservas","cobranzas","sucursales","contabilidad","compras","delivery"]}')
ON CONFLICT (code) DO NOTHING;
