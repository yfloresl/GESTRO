-- gestro-032: criterio con que se separa el IVA del precio para el margen neto de las recetas (informativo). Configurable por sucursal.
-- 'incluido' = el precio ya trae el IVA (IVA = precio × 13 / 113, como los asientos contables); 'porcentaje' = 13 % del precio. Aditiva y reversible.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS iva_criterio TEXT NOT NULL DEFAULT 'incluido';
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_iva_criterio_chk;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_iva_criterio_chk CHECK (iva_criterio IN ('incluido', 'porcentaje'));
