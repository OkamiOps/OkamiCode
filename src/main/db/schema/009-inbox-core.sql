BEGIN IMMEDIATE;

CREATE TABLE connector_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('gmail', 'outlook', 'zoho', 'imap')),
  display_name TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'connected', 'syncing', 'degraded', 'auth_required', 'paused', 'unavailable'
  )),
  sync_cursor TEXT,
  last_error TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, address)
);

CREATE TABLE inbox_threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  external_thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  unread_count INTEGER NOT NULL CHECK(unread_count >= 0),
  last_message_at TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, external_thread_id),
  UNIQUE(account_id, id)
);

CREATE TABLE inbox_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing', 'draft')),
  sender TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  body TEXT NOT NULL,
  body_format TEXT NOT NULL CHECK(body_format IN ('text', 'html')),
  sent_at TEXT,
  received_at TEXT,
  attachments_json TEXT NOT NULL,
  untrusted_content INTEGER NOT NULL DEFAULT 1 CHECK(untrusted_content = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, external_message_id),
  FOREIGN KEY(account_id, thread_id)
    REFERENCES inbox_threads(account_id, id) ON DELETE CASCADE
);

CREATE INDEX inbox_threads_account_last_message_idx
  ON inbox_threads(account_id, last_message_at DESC, id DESC);
CREATE INDEX inbox_threads_account_unread_last_message_idx
  ON inbox_threads(account_id, unread_count, last_message_at DESC, id DESC);
CREATE INDEX inbox_messages_thread_sent_received_idx
  ON inbox_messages(thread_id, sent_at ASC, received_at ASC, id ASC);

PRAGMA user_version = 9;
COMMIT;
