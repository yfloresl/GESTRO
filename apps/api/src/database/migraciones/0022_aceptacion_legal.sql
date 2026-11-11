-- Evidencia de aceptación de términos, privacidad y políticas (una fila por persona y versión). Aditiva.
CREATE TABLE legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  kyros_sub TEXT,
  version TEXT NOT NULL,
  documents TEXT[] NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('registro', 'reaceptacion')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash TEXT,
  ua_hash TEXT,
  UNIQUE (user_id, version)
);
CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id, accepted_at DESC);
