-- F2b: recetas con versiones y sub-recetas, margen minimo por sucursal y resultado guardado del plan del dia.
-- Una sub-receta (salsa, base) produce un insumo: recipes.output_ingredient_id en vez de menu_item_id.
ALTER TABLE recipes ALTER COLUMN menu_item_id DROP NOT NULL;
ALTER TABLE recipes ADD COLUMN output_ingredient_id UUID REFERENCES ingredients(id);
ALTER TABLE recipes ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE recipes ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE recipes ADD CONSTRAINT recipes_un_destino CHECK ((menu_item_id IS NULL) <> (output_ingredient_id IS NULL));
CREATE UNIQUE INDEX recipes_version_insumo ON recipes(output_ingredient_id, version) WHERE output_ingredient_id IS NOT NULL;
-- Solo una version activa por plato o por sub-receta.
CREATE UNIQUE INDEX recipes_activa_plato ON recipes(menu_item_id) WHERE active AND menu_item_id IS NOT NULL;
CREATE UNIQUE INDEX recipes_activa_insumo ON recipes(output_ingredient_id) WHERE active AND output_ingredient_id IS NOT NULL;
ALTER TABLE restaurants ADD COLUMN min_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (min_margin_pct BETWEEN 0 AND 100);
ALTER TABLE production_plans ADD COLUMN requirements JSONB;
ALTER TABLE production_plans ADD COLUMN computed_at TIMESTAMPTZ;
ALTER TABLE production_plans ADD COLUMN created_by UUID REFERENCES users(id);
