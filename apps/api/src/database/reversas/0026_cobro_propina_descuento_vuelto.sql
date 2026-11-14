ALTER TABLE sales_payments DROP COLUMN IF EXISTS tip_amount, DROP COLUMN IF EXISTS discount_amount, DROP COLUMN IF EXISTS cash_received, DROP COLUMN IF EXISTS change_given;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_reason;
