-- F1a: avisos Web Push, foto de plato en el volumen local y escalamiento de solicitudes.
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON push_subscriptions(user_id);
ALTER TABLE menu_items ADD COLUMN photo_key TEXT;      -- clave en el volumen de archivos (no URL)
ALTER TABLE menu_items ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE service_requests ADD COLUMN escalated_at TIMESTAMPTZ;
-- Una sola solicitud abierta del mismo tipo por mesa (anti-abuso del QR).
CREATE UNIQUE INDEX service_requests_una_abierta ON service_requests(table_id, kind) WHERE status = 'pendiente';
ALTER TABLE staff_members ADD CONSTRAINT staff_members_user_unico UNIQUE (restaurant_id, user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO app_user;
