DROP TABLE IF EXISTS push_subscriptions;
ALTER TABLE menu_items DROP COLUMN photo_key, DROP COLUMN sort_order;
DROP INDEX IF EXISTS service_requests_una_abierta;
ALTER TABLE service_requests DROP COLUMN escalated_at;
ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_user_unico;
