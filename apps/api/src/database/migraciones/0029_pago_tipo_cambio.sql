-- Cada pago de suscripción guarda el tipo de cambio oficial (TCO) con el que se calculó el monto esperado de un plan en USD.
-- Aditiva y reversible. Nada se borra ni se recalcula: los pagos anteriores quedan como estaban.
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS fx_usd_bob NUMERIC(14,6) CHECK (fx_usd_bob IS NULL OR fx_usd_bob > 0);
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS fx_fecha DATE;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS fx_fuente TEXT;
COMMENT ON COLUMN plans.monthly_price_bob IS 'Precio manual en Bs. Si el plan tiene monthly_price_usd, el cobro en Bs es USD x TCO del día (no este valor, que puede ser un dato viejo de cuando el Bs era fijo).';
