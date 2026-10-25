-- Acceso con Kyros ID (kyros-id-unico-standard.md): GESTRO no guarda contraseñas ni segundo factor.
-- Un vínculo une un `sub` del emisor con un usuario local. Nunca se vincula por correo.

CREATE TABLE app_config (                 -- configuración cifrada (AES-256-GCM con la llave maestra)
  clave TEXT PRIMARY KEY,
  valor_cifrado TEXT NOT NULL,
  actualizado_por UUID,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kyros_links (
  issuer TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, sub)
);

-- El vínculo es inmutable: desvincular = borrar.
CREATE FUNCTION kyros_links_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'kyros_links es inmutable: desvincular es borrar la fila'; END $$;
CREATE TRIGGER trg_kyros_links_inmutable BEFORE UPDATE ON kyros_links
  FOR EACH ROW EXECUTE FUNCTION kyros_links_inmutable();

CREATE TABLE kyros_used_tokens (          -- jti de un solo uso
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Invitación de personal: el dueño crea el usuario con su rol y entrega un código de un solo uso.
-- La persona entra con Kyros ID y el código prueba que es quien debe ocupar ese usuario.
CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesión: refresh opaco, rotativo, con familia para detectar robo.
ALTER TABLE refresh_tokens
  ADD COLUMN family_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN used_at TIMESTAMPTZ,
  ADD COLUMN issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN ip INET,
  ADD COLUMN kyros_sub TEXT;               -- para el cierre global (back-channel logout)
CREATE UNIQUE INDEX refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX refresh_tokens_sub ON refresh_tokens(kyros_sub);

-- Roles base (permisos finos se completan por módulo).
INSERT INTO roles (code, description) VALUES
  ('owner','Dueño de la cuenta'), ('admin','Administrador'), ('cobranzas','Encargado de cobranzas'),
  ('cajero','Cajero'), ('mesero','Mesero'), ('area_manager','Encargado de área'),
  ('cocina','Jefe de cocina'), ('almacen','Almacén'), ('contador','Contador')
ON CONFLICT (code) DO NOTHING;

-- La aplicación se conecta como el dueño de las tablas sin contraseña (red interna) y en cada
-- transacción de negocio hace SET LOCAL ROLE app_user, que no puede saltarse el RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user;
