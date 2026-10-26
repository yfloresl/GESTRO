DELETE FROM chart_of_accounts a WHERE a.system_key = 'anticipos' AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id);
ALTER TABLE payables_receivables DROP COLUMN event_id;
DROP TABLE IF EXISTS event_payments;
DROP INDEX IF EXISTS events_fecha;
ALTER TABLE events DROP COLUMN closed_at, DROP COLUMN consumed_at, DROP COLUMN created_at, DROP COLUMN created_by, DROP COLUMN notes;
