-- GST-010: los topes de descuento y de propina del cobro dejan de ser fijos (30 %) y se configuran por restaurante. Aditiva: por defecto 30.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS discount_max_pct NUMERIC(5,2) NOT NULL DEFAULT 30 CHECK (discount_max_pct >= 0 AND discount_max_pct <= 100);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS tip_max_pct NUMERIC(5,2) NOT NULL DEFAULT 30 CHECK (tip_max_pct >= 0 AND tip_max_pct <= 100);
