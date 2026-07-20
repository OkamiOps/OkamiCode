BEGIN IMMEDIATE;

CREATE TABLE external_outbox (
  id TEXT PRIMARY KEY,
  connector_account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN (
    'draft',
    'approval_pending',
    'dispatching',
    'confirmed',
    'uncertain',
    'failed_retryable',
    'failed_terminal'
  )),
  requires_approval INTEGER NOT NULL CHECK(requires_approval IN (0, 1)),
  approved_at TEXT,
  safe_retry INTEGER NOT NULL CHECK(safe_retry IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  provider_receipt_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX external_outbox_status_updated_idx
  ON external_outbox(status, updated_at, id);

PRAGMA user_version = 8;
COMMIT;
