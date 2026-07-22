BEGIN IMMEDIATE;

ALTER TABLE inbox_messages ADD COLUMN provider_uid TEXT;

CREATE UNIQUE INDEX inbox_messages_account_provider_uid_idx
  ON inbox_messages(account_id, provider_uid)
  WHERE provider_uid IS NOT NULL;

-- Re-read the bounded recent window once so existing messages receive their
-- stable IMAP UID without discarding any local conversation data.
UPDATE connector_accounts SET sync_cursor = NULL;

PRAGMA user_version = 20;
COMMIT;
