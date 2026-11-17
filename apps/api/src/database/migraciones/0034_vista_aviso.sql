-- Aviso de FacturaSIN v2.2: factura de Kyros-Tech con su vista COMPLETA registrada (fs_response, verified_at). Aditiva y reversible.
ALTER TABLE kyros_invoices ADD COLUMN IF NOT EXISTS fs_response JSONB;
ALTER TABLE kyros_invoices ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
