DROP TRIGGER IF EXISTS trg_kyros_links_inmutable ON kyros_links;
DROP FUNCTION IF EXISTS kyros_links_inmutable();
DROP TABLE IF EXISTS user_invitations, kyros_used_tokens, kyros_links, app_config;
ALTER TABLE refresh_tokens DROP COLUMN family_id, DROP COLUMN used_at, DROP COLUMN issued_at, DROP COLUMN ip, DROP COLUMN kyros_sub;
DELETE FROM roles;
