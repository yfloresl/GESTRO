-- gestro-p02: la propina que corresponde a cada mesero por día se marca como entregada (quién y cuándo). Aditiva y reversible.
CREATE TABLE tip_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  staff_id UUID NOT NULL REFERENCES staff_members(id),
  day DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  delivered_by UUID REFERENCES users(id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, staff_id, day)
);
ALTER TABLE tip_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tip_payouts USING (app_restaurant_ok(restaurant_id)) WITH CHECK (app_restaurant_ok(restaurant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON tip_payouts TO app_user;
