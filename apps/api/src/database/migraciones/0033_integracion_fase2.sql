-- Fase 2 integracion FacturaSIN (GESTRO): Flujo 2 en 3 pasos, lineas libres y registro de la factura validada. Aditiva y reversible.
--  * billing_settings: actividades y producto SIN por defecto dejan de ser obligatorios (los completa FacturaSIN desde el rubro de la empresa).
--  * fiscal_invoices.snapshot: la factura COMPLETA tal como la devolvio el SIN (webhook firmado o consulta), sin alterar datos fiscales.
ALTER TABLE billing_settings DROP CONSTRAINT IF EXISTS billing_settings_economic_activities_check;
ALTER TABLE billing_settings ALTER COLUMN economic_activities DROP NOT NULL;
ALTER TABLE billing_settings ALTER COLUMN default_sin_product_code DROP NOT NULL;
ALTER TABLE fiscal_invoices ADD COLUMN IF NOT EXISTS snapshot JSONB;
