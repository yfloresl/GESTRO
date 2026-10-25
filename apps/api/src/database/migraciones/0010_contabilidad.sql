-- F3: contabilidad de nivel medio. Partida doble, asientos publicados inmutables, períodos que se cierran.

ALTER TABLE chart_of_accounts ADD COLUMN system_key TEXT;                       -- clave estable para los asientos automáticos (caja, ventas...)
ALTER TABLE chart_of_accounts ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX chart_of_accounts_system_key ON chart_of_accounts(restaurant_id, system_key) WHERE system_key IS NOT NULL;

ALTER TABLE journal_entries ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE journal_entries ADD COLUMN posted_at TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN reversal_of UUID REFERENCES journal_entries(id);
CREATE UNIQUE INDEX journal_entries_una_reversa ON journal_entries(reversal_of) WHERE reversal_of IS NOT NULL;   -- un asiento se contrarresta una sola vez
CREATE UNIQUE INDEX journal_entries_origen ON journal_entries(restaurant_id, source, source_id) WHERE source <> 'manual' AND source_id IS NOT NULL AND reversal_of IS NULL;   -- un hecho genera un solo asiento
CREATE INDEX journal_lines_cuenta ON journal_lines(restaurant_id, account_id);

ALTER TABLE fiscal_periods ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE fiscal_periods ADD COLUMN closed_by UUID REFERENCES users(id);

-- Tasas de impuestos: parámetros por sucursal, nunca constantes en el código (la cifra final la valida el contador).
ALTER TABLE restaurants ADD COLUMN iva_pct NUMERIC(5,2) NOT NULL DEFAULT 13 CHECK (iva_pct BETWEEN 0 AND 100);
ALTER TABLE restaurants ADD COLUMN it_pct NUMERIC(5,2) NOT NULL DEFAULT 3 CHECK (it_pct BETWEEN 0 AND 100);

-- Facturas de proveedor con IVA (libro de compras): la recepción indica si la factura lo trae incluido.
ALTER TABLE purchase_receipts ADD COLUMN has_iva BOOLEAN NOT NULL DEFAULT false;

-- ---------- Reglas en la base ----------
-- Un asiento publicado no se edita ni se borra: se contrarresta con otro.
CREATE FUNCTION journal_publicado_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posted THEN RAISE EXCEPTION 'Un asiento publicado no se borra: se contrarresta con otro asiento'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.posted THEN RAISE EXCEPTION 'Un asiento publicado no se edita: se contrarresta con otro asiento'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_inmutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_publicado_inmutable();

CREATE FUNCTION journal_lines_publicadas_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pub BOOLEAN; eid UUID;
BEGIN
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  SELECT posted INTO pub FROM journal_entries WHERE id = eid;
  IF pub THEN RAISE EXCEPTION 'Las líneas de un asiento publicado no se modifican'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER journal_lines_inmutables BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION journal_lines_publicadas_inmutables();

-- No se publican asientos en un período cerrado.
CREATE FUNCTION journal_periodo_abierto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.posted AND EXISTS (SELECT 1 FROM fiscal_periods p WHERE p.restaurant_id = NEW.restaurant_id AND p.closed
        AND p.year = EXTRACT(YEAR FROM NEW.entry_date)::int AND p.month = EXTRACT(MONTH FROM NEW.entry_date)::int) THEN
    RAISE EXCEPTION 'El período % / % está cerrado: no se registran asientos en él', EXTRACT(MONTH FROM NEW.entry_date)::int, EXTRACT(YEAR FROM NEW.entry_date)::int;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_periodo BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_periodo_abierto();

-- ---------- Valorización automática del kardex ----------
-- Toda salida (y todo movimiento sin costo que no sea compra) se valoriza al costo promedio vigente del almacén; si aún no hay
-- promedio, al último costo del insumo. Así consumo, mermas y ajustes tienen valor para la contabilidad sin que cada servicio lo calcule.
CREATE FUNCTION stock_movement_valorizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost IS NULL AND NEW.kind <> 'compra' THEN
    SELECT CASE WHEN COALESCE(s.avg_cost, 0) > 0 THEN s.avg_cost ELSE i.last_cost END INTO NEW.unit_cost
      FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = NEW.warehouse_id WHERE i.id = NEW.ingredient_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stock_movement_valorizar BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_valorizar();
