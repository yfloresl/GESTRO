DROP INDEX IF EXISTS order_items_promocion;
ALTER TABLE order_items DROP COLUMN promotion_id, DROP COLUMN list_price;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_dias_validos, DROP CONSTRAINT IF EXISTS promotions_horario_completo,
  DROP CONSTRAINT IF EXISTS promotions_precio_fijo_positivo, DROP CONSTRAINT IF EXISTS promotions_una_regla;
ALTER TABLE promotions DROP COLUMN created_at;
