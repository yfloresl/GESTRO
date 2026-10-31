DELETE FROM plans WHERE code IN ('esencial','profesional','cadena') AND id NOT IN (SELECT plan_id FROM restaurants WHERE plan_id IS NOT NULL);
