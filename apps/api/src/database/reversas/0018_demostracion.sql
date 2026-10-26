DROP INDEX IF EXISTS restaurants_una_demostracion;
ALTER TABLE restaurants DROP COLUMN demo_days, DROP COLUMN demo_reset_at, DROP COLUMN is_demo;
