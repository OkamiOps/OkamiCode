import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { Database } from "../connection";

interface EventRow {
  id: string;
  task_id: string;
  lane_id: string;
  run_id: string;
  sequence: number;
  occurred_at: string;
  kind: CanonicalEventKind;
  native_event_id: string | null;
  payload_json: string;
}

export class EventRepository {
  constructor(private readonly db: Database) {}

  append(event: CanonicalEvent): { inserted: boolean } {
    const parsed = canonicalEventSchema.parse(event);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
         (id, task_id, lane_id, run_id, sequence, occurred_at, kind,
          native_event_id, payload_json)
         VALUES (@id, @taskId, @laneId, @runId, @sequence, @occurredAt, @kind,
                 @nativeEventId, @payload)`,
      )
      .run({ ...parsed, payload: JSON.stringify(parsed.payload) });
    return { inserted: result.changes === 1 };
  }

  afterCursor(laneId: string, cursor: number): CanonicalEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE lane_id = ? AND sequence > ?
         ORDER BY sequence ASC`,
      )
      .all(laneId, cursor) as EventRow[];
    return rows.map(rowToEvent);
  }
}

function rowToEvent(row: EventRow): CanonicalEvent {
  return canonicalEventSchema.parse({
    schemaVersion: 1,
    id: row.id,
    taskId: row.task_id,
    laneId: row.lane_id,
    runId: row.run_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    kind: row.kind,
    nativeEventId: row.native_event_id,
    payload: JSON.parse(row.payload_json),
  });
}
