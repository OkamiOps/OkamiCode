BEGIN IMMEDIATE;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('workbench','quick_chat')),
  title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX conversations_task_idx ON conversations(task_id);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sequence INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(conversation_id, sequence)
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, sequence);
CREATE TABLE runtime_lanes (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), runtime_kind TEXT NOT NULL,
  provider_kind TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
  workspace_path TEXT, last_event_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX runtime_lanes_task_idx ON runtime_lanes(task_id);
CREATE TABLE native_session_bindings (
  lane_id TEXT PRIMARY KEY REFERENCES runtime_lanes(id), native_session_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL, bound_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), status TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, error_json TEXT
);
CREATE INDEX runs_lane_idx ON runs(lane_id, started_at);
CREATE TABLE events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, kind TEXT NOT NULL,
  native_event_id TEXT, payload_json TEXT NOT NULL,
  UNIQUE(lane_id, sequence)
);
CREATE UNIQUE INDEX events_native_id_idx ON events(lane_id, native_event_id) WHERE native_event_id IS NOT NULL;
CREATE INDEX events_run_idx ON events(run_id, sequence);
CREATE TABLE event_cursors (
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  source_lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), last_sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(lane_id, source_lane_id)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
  uri TEXT NOT NULL, content_hash TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX artifacts_run_idx ON artifacts(run_id);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  capability TEXT NOT NULL, resource_json TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL,
  resolution TEXT, requested_at TEXT NOT NULL, resolved_at TEXT, expires_at TEXT NOT NULL
);
CREATE INDEX approvals_lane_status_idx ON approvals(lane_id, status);
CREATE TABLE capability_leases (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  actor TEXT NOT NULL, capability TEXT NOT NULL, resource_pattern TEXT NOT NULL,
  budget_json TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX leases_lane_capability_idx ON capability_leases(lane_id, capability, expires_at);
CREATE TABLE usage_sources (
  id TEXT PRIMARY KEY, provider_kind TEXT NOT NULL, account_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL, adapter_version TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(provider_kind, account_ref, source_kind)
);
CREATE TABLE usage_windows (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES usage_sources(id), window_kind TEXT NOT NULL,
  model_group TEXT, duration_minutes INTEGER, UNIQUE(source_id, window_kind, model_group)
);
CREATE TABLE usage_snapshots (
  id TEXT PRIMARY KEY, window_id TEXT NOT NULL REFERENCES usage_windows(id),
  used_percent REAL, remaining_percent REAL, resets_at TEXT, credits_json TEXT,
  freshness TEXT NOT NULL, reliability TEXT NOT NULL, native_payload_json TEXT,
  collected_at TEXT NOT NULL, valid_until TEXT
);
CREATE INDEX usage_snapshots_window_idx ON usage_snapshots(window_id, collected_at DESC);
CREATE TABLE usage_activity_buckets (
  id TEXT PRIMARY KEY, lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  bucket_start TEXT NOT NULL, bucket_minutes INTEGER NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0, UNIQUE(lane_id, bucket_start, bucket_minutes, model)
);
CREATE TABLE memory_sources (
  id TEXT PRIMARY KEY, root_path TEXT NOT NULL, scope_path TEXT NOT NULL, access_mode TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(root_path, scope_path)
);
CREATE TABLE memory_documents (
  id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES memory_sources(id), path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, frontmatter_json TEXT NOT NULL, plain_text TEXT NOT NULL,
  content_hash TEXT NOT NULL, modified_at TEXT NOT NULL, indexed_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE memory_fts USING fts5(title, plain_text, content='memory_documents', content_rowid='id');
CREATE TRIGGER memory_ai AFTER INSERT ON memory_documents BEGIN
  INSERT INTO memory_fts(rowid,title,plain_text) VALUES(new.id,new.title,new.plain_text);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory_documents BEGIN
  INSERT INTO memory_fts(memory_fts,rowid,title,plain_text) VALUES('delete',old.id,old.title,old.plain_text);
END;
CREATE TRIGGER memory_au AFTER UPDATE ON memory_documents BEGIN
  INSERT INTO memory_fts(memory_fts,rowid,title,plain_text) VALUES('delete',old.id,old.title,old.plain_text);
  INSERT INTO memory_fts(rowid,title,plain_text) VALUES(new.id,new.title,new.plain_text);
END;
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY, task_id TEXT, lane_id TEXT, run_id TEXT, actor TEXT NOT NULL,
  action TEXT NOT NULL, decision TEXT, capability TEXT, resource_json TEXT,
  metadata_json TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE INDEX audit_task_time_idx ON audit_entries(task_id, occurred_at);

PRAGMA user_version = 1;
COMMIT;
