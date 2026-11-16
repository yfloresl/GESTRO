ALTER TABLE billing_settings DROP COLUMN IF EXISTS codes_confirmed;
ALTER TABLE billing_settings DROP COLUMN IF EXISTS payment_codes;
ALTER TABLE billing_settings DROP COLUMN IF EXISTS tax_regime;
ALTER TABLE accounts DROP COLUMN IF EXISTS fiscal_regime;
ALTER TABLE kyros_invoices DROP COLUMN IF EXISTS iva_mode;
ALTER TABLE kyros_invoices DROP COLUMN IF EXISTS net_bob_cent;
