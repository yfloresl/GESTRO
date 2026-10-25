ALTER TABLE production_plans DROP COLUMN requirements, DROP COLUMN computed_at, DROP COLUMN created_by;
ALTER TABLE restaurants DROP COLUMN min_margin_pct;
DROP INDEX IF EXISTS recipes_activa_insumo; DROP INDEX IF EXISTS recipes_activa_plato; DROP INDEX IF EXISTS recipes_version_insumo;
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_un_destino;
ALTER TABLE recipes DROP COLUMN output_ingredient_id, DROP COLUMN created_by, DROP COLUMN created_at;
