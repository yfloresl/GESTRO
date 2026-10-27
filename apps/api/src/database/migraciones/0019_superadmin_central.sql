-- SuperAdmin central de Kyros ID (superadmin-central-standard.md). Solo cambios aditivos.
-- origen = PLATAFORMA: usuario creado al vuelo por el claim kyros_pa; nunca lleva is_platform_admin persistido.
ALTER TABLE kyros_links ADD COLUMN origen TEXT NOT NULL DEFAULT 'LOCAL' CHECK (origen IN ('LOCAL','PLATAFORMA'));
-- Una sesión central dura como máximo hasta central_hasta (60 min absolutos); el refresco no la extiende.
ALTER TABLE refresh_tokens ADD COLUMN central_hasta TIMESTAMPTZ;
