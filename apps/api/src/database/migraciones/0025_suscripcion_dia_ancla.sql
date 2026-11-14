-- GS-C04: día ancla del ciclo mensual de la suscripción (evita perder días en renovaciones sucesivas). Aditiva; NULL = se deduce del vencimiento.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS billing_anchor_day SMALLINT CHECK (billing_anchor_day BETWEEN 1 AND 31);
