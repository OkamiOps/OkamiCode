BEGIN IMMEDIATE;

-- Hostinger publishes one canonical SSL endpoint for incoming and outgoing mail.
-- Backfill only that exact host and never overwrite an explicit SMTP choice.
INSERT INTO inbox_outgoing_settings
  (account_id, host, port, secure, from_addresses_json, created_at, updated_at)
SELECT
  account_id,
  'smtp.hostinger.com',
  465,
  1,
  '[]',
  created_at,
  updated_at
FROM inbox_account_settings
WHERE lower(trim(host)) = 'imap.hostinger.com'
ON CONFLICT(account_id) DO NOTHING;

PRAGMA user_version = 17;
COMMIT;
