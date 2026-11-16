-- Normativa de facturacion (informe QA-NORMATIVA-FACTURACION, 15/11/2026). Aditiva y reversible.
-- Flujo 1: neto/IVA/total por separado y modo de IVA por factura (el TCO ya se guarda en fx_usd_bob/fx_fecha).
ALTER TABLE kyros_invoices ADD COLUMN IF NOT EXISTS net_bob_cent BIGINT;
ALTER TABLE kyros_invoices ADD COLUMN IF NOT EXISTS iva_mode TEXT NOT NULL DEFAULT 'por_dentro' CHECK (iva_mode IN ('por_dentro','por_fuera'));
UPDATE kyros_invoices SET net_bob_cent = total_bob_cent - iva_bob_cent WHERE net_bob_cent IS NULL;
-- F10: regimen tributario declarado (solo para avisar; no bloquea).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fiscal_regime TEXT NOT NULL DEFAULT 'no_declarado' CHECK (fiscal_regime IN ('general','simplificado','no_declarado'));
-- Flujo 2: regimen del restaurante emisor, codigos de metodo de pago como configuracion y su confirmacion por el contador.
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS tax_regime TEXT NOT NULL DEFAULT 'no_declarado' CHECK (tax_regime IN ('general','simplificado','no_declarado'));
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS payment_codes JSONB NOT NULL DEFAULT '{"efectivo":1,"tarjeta":2,"otro":7}'::jsonb;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS codes_confirmed BOOLEAN NOT NULL DEFAULT false;
