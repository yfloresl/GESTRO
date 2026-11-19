-- Estándar Kyros v1.2: QR de cobro como ARCHIVO subido (sin URLs). Aditiva y reversible.
-- ambito 'plataforma' = QR de Kyros-Tech para la suscripción (propietario_id ''); 'cliente' = QR de la sucursal del restaurante (propietario_id = restaurants.id).
-- El id es opaco (uuid): al reemplazar se crea uno nuevo y el anterior deja de existir. Sin RLS: el servidor decide el permiso antes de leer o escribir.
CREATE TABLE IF NOT EXISTS kyros_qr_cobro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambito TEXT NOT NULL CHECK (ambito IN ('plataforma','cliente')),
  propietario_id TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  contenido BYTEA NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  banco VARCHAR(60),
  subido_por TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambito, propietario_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON kyros_qr_cobro TO app_user;
