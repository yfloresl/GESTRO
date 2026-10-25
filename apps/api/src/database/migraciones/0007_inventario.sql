-- F2a: inventario por movimientos. El stock NUNCA se edita a mano: cada movimiento del kardex actualiza
-- stock_levels con un disparador, y la aplicación (app_user) no tiene permiso para escribir en stock_levels
-- ni para modificar o borrar movimientos (el kardex es un libro de solo-añadir).

-- Unidades base: g, ml y un. Las demás se expresan con su factor hacia la base (libra boliviana = 453.592 g).
INSERT INTO units (code, base_code, factor_to_base) VALUES
  ('g','g',1), ('kg','g',1000), ('lb','g',453.592), ('ml','ml',1), ('l','ml',1000), ('un','un',1), ('doc','un',12)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE stock_movements ADD COLUMN reason TEXT;                 -- motivo de merma o ajuste (obligatorio en esos tipos)
ALTER TABLE stock_movements ADD COLUMN group_id UUID;               -- une las dos patas de un traspaso o los renglones de un conteo
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_motivo CHECK (kind NOT IN ('merma','ajuste') OR reason IS NOT NULL);
ALTER TABLE ingredients ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ingredients ADD COLUMN cost_method TEXT NOT NULL DEFAULT 'promedio' CHECK (cost_method IN ('promedio','ultimo'));

CREATE INDEX stock_movements_lote ON stock_movements(restaurant_id, ingredient_id, warehouse_id, lot) WHERE lot IS NOT NULL;

-- Disparador: aplica cada movimiento al nivel de stock. Entradas con costo recalculan el promedio ponderado
-- (con saldo negativo se parte de cero); las compras actualizan además el último costo del insumo.
CREATE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_qty NUMERIC; old_avg NUMERIC; base NUMERIC;
BEGIN
  SELECT qty, avg_cost INTO old_qty, old_avg FROM stock_levels
    WHERE warehouse_id = NEW.warehouse_id AND ingredient_id = NEW.ingredient_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO stock_levels (restaurant_id, warehouse_id, ingredient_id, qty, avg_cost)
      VALUES (NEW.restaurant_id, NEW.warehouse_id, NEW.ingredient_id, NEW.qty, COALESCE(NEW.unit_cost, 0));
  ELSE
    base := GREATEST(old_qty, 0);
    IF NEW.qty > 0 AND NEW.unit_cost IS NOT NULL AND (base + NEW.qty) > 0 THEN
      UPDATE stock_levels SET qty = old_qty + NEW.qty, avg_cost = round((base * old_avg + NEW.qty * NEW.unit_cost) / (base + NEW.qty), 4)
        WHERE warehouse_id = NEW.warehouse_id AND ingredient_id = NEW.ingredient_id;
    ELSE
      UPDATE stock_levels SET qty = old_qty + NEW.qty WHERE warehouse_id = NEW.warehouse_id AND ingredient_id = NEW.ingredient_id;
    END IF;
  END IF;
  IF NEW.kind = 'compra' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE ingredients SET last_cost = NEW.unit_cost WHERE id = NEW.ingredient_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_apply_stock_movement AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

REVOKE INSERT, UPDATE, DELETE ON stock_levels FROM app_user;
REVOKE UPDATE, DELETE ON stock_movements FROM app_user;
