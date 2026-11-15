DROP TABLE IF EXISTS kyros_invoice_events;
DROP TABLE IF EXISTS kyros_invoices;
ALTER TABLE accounts DROP COLUMN IF EXISTS fiscal_email;
ALTER TABLE accounts DROP COLUMN IF EXISTS fiscal_doc_complement;
ALTER TABLE accounts DROP COLUMN IF EXISTS fiscal_doc_type;
