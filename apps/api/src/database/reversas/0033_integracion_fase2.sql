-- Reversa: ALTER TABLE fiscal_invoices DROP COLUMN IF EXISTS snapshot; (las columnas NOT NULL de billing_settings no se vuelven a imponer: hay filas sin actividades).
ALTER TABLE fiscal_invoices DROP COLUMN IF EXISTS snapshot;
