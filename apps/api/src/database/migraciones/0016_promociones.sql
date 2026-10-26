-- F4d: promociones del restaurante. El precio con promoción se fija al agregar el plato al pedido y se guarda con el precio de lista.
ALTER TABLE promotions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE promotions ADD CONSTRAINT promotions_una_regla CHECK ((discount_pct IS NOT NULL) <> (fixed_price IS NOT NULL));
ALTER TABLE promotions ADD CONSTRAINT promotions_precio_fijo_positivo CHECK (fixed_price IS NULL OR fixed_price > 0);
ALTER TABLE promotions ADD CONSTRAINT promotions_horario_completo CHECK ((start_time IS NULL) = (end_time IS NULL));
ALTER TABLE promotions ADD CONSTRAINT promotions_dias_validos CHECK (weekdays IS NULL OR (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]));

ALTER TABLE order_items ADD COLUMN list_price NUMERIC(12,2);                                   -- precio de carta; unit_price es el que se cobra
ALTER TABLE order_items ADD COLUMN promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL;
CREATE INDEX order_items_promocion ON order_items(promotion_id) WHERE promotion_id IS NOT NULL;
