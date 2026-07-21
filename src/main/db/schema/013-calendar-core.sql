BEGIN IMMEDIATE;

CREATE TABLE calendar_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('local', 'google', 'outlook', 'caldav', 'ics')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 255),
  color TEXT NOT NULL CHECK(color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  timezone TEXT NOT NULL CHECK(length(trim(timezone)) BETWEEN 1 AND 255),
  status TEXT NOT NULL CHECK(status IN ('active', 'not_configured', 'paused', 'degraded')),
  sync_cursor TEXT,
  last_error TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 1000),
  description TEXT,
  location TEXT,
  organizer TEXT,
  join_url TEXT,
  source_url TEXT,
  etag TEXT,
  provider_updated_at TEXT,
  attendees_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attendees_json)),
  status TEXT NOT NULL CHECK(status IN ('confirmed', 'tentative', 'cancelled')),
  all_day INTEGER NOT NULL CHECK(all_day IN (0, 1)),
  timezone TEXT NOT NULL CHECK(length(trim(timezone)) BETWEEN 1 AND 255),
  starts_at TEXT,
  ends_at TEXT,
  start_date TEXT,
  end_date TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, external_id),
  CHECK(
    (all_day = 0 AND starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND start_date IS NULL AND end_date IS NULL)
    OR
    (all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL
      AND starts_at IS NULL AND ends_at IS NULL)
  )
);

CREATE INDEX calendar_events_source_id_idx ON calendar_events(source_id);
CREATE INDEX calendar_events_timed_window_idx ON calendar_events(starts_at, ends_at)
  WHERE all_day = 0 AND deleted_at IS NULL;
CREATE INDEX calendar_events_all_day_window_idx ON calendar_events(start_date, end_date)
  WHERE all_day = 1 AND deleted_at IS NULL;

PRAGMA user_version = 13;
COMMIT;
