DROP TABLE IF EXISTS subscription_notices;
ALTER TABLE saas_promotions DROP COLUMN active;
ALTER TABLE subscription_payments DROP COLUMN bank, DROP COLUMN paid_on, DROP COLUMN created_by, DROP COLUMN expected_amount, DROP COLUMN gift_months;
