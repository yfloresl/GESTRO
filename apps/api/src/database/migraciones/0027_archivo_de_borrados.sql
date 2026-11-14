-- «Nada se borra»: antes de eliminar un registro del negocio se guarda su copia completa (con quién y cuándo). Aditiva.
CREATE TABLE archived_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  entity TEXT NOT NULL,
  entity_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX archived_records_ent ON archived_records(restaurant_id, entity, entity_id);
ALTER TABLE archived_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE archived_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON archived_records USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id));
GRANT SELECT, INSERT ON archived_records TO app_user;
