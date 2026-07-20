import { createHash } from "node:crypto";
import type { Database } from "../db/connection";
import type { LaneRepository } from "../db/repositories/lanes";

export type KanbanCardStatus = "backlog" | "in_progress" | "review" | "done";
export type KanbanOwnerKind = "human" | "lane";
export type KanbanActivationPolicy =
  "manual" | "relevant_change" | "status_transition";

export interface KanbanCardRecord {
  id: string;
  taskId: string | null;
  title: string;
  description: string;
  status: KanbanCardStatus;
  ownerKind: KanbanOwnerKind;
  laneId: string | null;
  activationPolicy: KanbanActivationPolicy;
  position: number;
  stateHash: string;
  lastProcessedHash: string;
  lastProcessedCursor: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanCardEventRecord {
  id: string;
  cardId: string;
  sequence: number;
  kind: "created" | "moved" | "assigned";
  idempotencyKey: string;
  delta: KanbanCardDelta;
  stateHash: string;
  occurredAt: string;
}

export interface KanbanCardDelta {
  stateChanged: boolean;
  statusChanged: boolean;
  ownerChanged: boolean;
  laneChanged: boolean;
}

export interface KanbanWakeDecision {
  shouldWake: boolean;
  reason:
    | "manual_policy"
    | "relevant_change"
    | "status_transition"
    | "no_relevant_change"
    | "human_owner"
    | "lane_missing"
    | "idempotent";
  delta: KanbanCardDelta;
}

export interface KanbanCardMutationResult {
  card: KanbanCardRecord;
  wake: KanbanWakeDecision;
}

export interface CreateKanbanCardInput {
  taskId?: string | null;
  title: string;
  description: string;
  status?: KanbanCardStatus;
  ownerKind?: KanbanOwnerKind;
  laneId?: string | null;
  activationPolicy?: KanbanActivationPolicy;
  position?: number;
}

export interface MoveKanbanCardInput {
  cardId: string;
  status: KanbanCardStatus;
  position?: number;
  idempotencyKey: string;
}

export interface AssignKanbanCardInput {
  cardId: string;
  ownerKind: KanbanOwnerKind;
  laneId: string | null;
  activationPolicy?: KanbanActivationPolicy;
  idempotencyKey: string;
}

interface CardRow {
  id: string;
  task_id: string | null;
  title: string;
  description: string;
  status: KanbanCardStatus;
  owner_kind: KanbanOwnerKind;
  lane_id: string | null;
  activation_policy: KanbanActivationPolicy;
  position: number;
  state_hash: string;
  last_processed_hash: string;
  last_processed_cursor: number;
  created_at: string;
  updated_at: string;
}

interface CardEventRow {
  id: string;
  card_id: string;
  sequence: number;
  kind: KanbanCardEventRecord["kind"];
  idempotency_key: string;
  delta_json: string;
  state_hash: string;
  occurred_at: string;
}

export class KanbanCardRepository {
  constructor(private readonly db: Database) {}

  insert(card: KanbanCardRecord): void {
    this.db
      .prepare(
        `INSERT INTO kanban_cards
         (id, task_id, title, description, status, owner_kind, lane_id,
          activation_policy, position, state_hash, last_processed_hash,
          last_processed_cursor, created_at, updated_at)
         VALUES (@id, @taskId, @title, @description, @status, @ownerKind, @laneId,
                 @activationPolicy, @position, @stateHash, @lastProcessedHash,
                 @lastProcessedCursor, @createdAt, @updatedAt)`,
      )
      .run(card);
  }

  findById(id: string): KanbanCardRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM kanban_cards WHERE id = ?")
      .get(id) as CardRow | undefined;
    return row ? rowToCard(row) : undefined;
  }

  list(taskId?: string | null): KanbanCardRecord[] {
    const rows =
      taskId === undefined
        ? (this.db
            .prepare("SELECT * FROM kanban_cards ORDER BY position ASC, id ASC")
            .all() as CardRow[])
        : (this.db
            .prepare(
              `SELECT * FROM kanban_cards
             WHERE task_id IS ?
             ORDER BY position ASC, id ASC`,
            )
            .all(taskId) as CardRow[]);
    return rows.map(rowToCard);
  }

  update(card: KanbanCardRecord): void {
    this.db
      .prepare(
        `UPDATE kanban_cards
         SET task_id = @taskId, title = @title, description = @description, status = @status,
             owner_kind = @ownerKind, lane_id = @laneId,
             activation_policy = @activationPolicy, position = @position,
             state_hash = @stateHash, last_processed_hash = @lastProcessedHash,
             last_processed_cursor = @lastProcessedCursor, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run(card);
  }

  markProcessed(
    cardId: string,
    stateHash: string,
    cursor: number,
    updatedAt: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE kanban_cards
         SET last_processed_hash = ?, last_processed_cursor = ?, updated_at = ?
         WHERE id = ? AND state_hash = ? AND last_processed_cursor < ?`,
      )
      .run(stateHash, cursor, updatedAt, cardId, stateHash, cursor);
    return result.changes === 1;
  }

  appendEvent(event: KanbanCardEventRecord): { inserted: boolean } {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO kanban_card_events
         (id, card_id, sequence, kind, idempotency_key, delta_json, state_hash, occurred_at)
         VALUES (@id, @cardId, @sequence, @kind, @idempotencyKey, @deltaJson,
                 @stateHash, @occurredAt)`,
      )
      .run({ ...event, deltaJson: JSON.stringify(event.delta) });
    return { inserted: result.changes === 1 };
  }

  findEventByIdempotencyKey(
    idempotencyKey: string,
  ): KanbanCardEventRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM kanban_card_events WHERE idempotency_key = ?")
      .get(idempotencyKey) as CardEventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  listEvents(cardId: string): KanbanCardEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM kanban_card_events
         WHERE card_id = ?
         ORDER BY sequence ASC`,
      )
      .all(cardId) as CardEventRow[];
    return rows.map(rowToEvent);
  }

  nextEventSequence(cardId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM kanban_card_events WHERE card_id = ?",
      )
      .get(cardId) as { sequence: number };
    return row.sequence;
  }
}

export class KanbanCardService {
  constructor(
    private readonly dependencies: {
      cards: KanbanCardRepository;
      lanes: Pick<LaneRepository, "findById">;
      createId: () => string;
      clock: () => string;
    },
  ) {}

  create(input: CreateKanbanCardInput): KanbanCardRecord {
    const now = this.dependencies.clock();
    const card = createCard({
      ...input,
      id: this.dependencies.createId(),
      now,
    });
    const event: KanbanCardEventRecord = {
      id: this.dependencies.createId(),
      cardId: card.id,
      sequence: 1,
      kind: "created",
      idempotencyKey: `create:${card.id}`,
      delta: emptyDelta(),
      stateHash: card.stateHash,
      occurredAt: now,
    };
    this.dependencies.cards.insert(card);
    this.dependencies.cards.appendEvent(event);
    return card;
  }

  list(taskId?: string | null): KanbanCardRecord[] {
    return this.dependencies.cards.list(taskId);
  }

  listEvents(cardId: string): KanbanCardEventRecord[] {
    return this.dependencies.cards.listEvents(cardId);
  }

  move(input: MoveKanbanCardInput): KanbanCardMutationResult {
    return this.mutate(input.cardId, input.idempotencyKey, "moved", (card) => ({
      ...card,
      status: input.status,
      position: input.position ?? card.position,
    }));
  }

  assign(input: AssignKanbanCardInput): KanbanCardMutationResult {
    if (input.ownerKind === "human" && input.laneId !== null) {
      throw new Error("Human-owned cards cannot target a lane");
    }
    if (input.ownerKind === "lane" && input.laneId === null) {
      throw new Error("Lane-owned cards require a lane id");
    }
    return this.mutate(
      input.cardId,
      input.idempotencyKey,
      "assigned",
      (card) => {
        const lane =
          input.ownerKind === "lane" && input.laneId !== null
            ? this.dependencies.lanes.findById(input.laneId)
            : undefined;
        return {
          ...card,
          taskId: lane?.taskId ?? card.taskId,
          ownerKind: input.ownerKind,
          laneId: input.laneId,
          activationPolicy: input.activationPolicy ?? card.activationPolicy,
        };
      },
    );
  }

  private mutate(
    cardId: string,
    idempotencyKey: string,
    kind: "moved" | "assigned",
    change: (card: KanbanCardRecord) => KanbanCardRecord,
  ): KanbanCardMutationResult {
    const duplicate =
      this.dependencies.cards.findEventByIdempotencyKey(idempotencyKey);
    if (duplicate) {
      const card = this.requireCard(duplicate.cardId);
      if (
        card.stateHash === duplicate.stateHash &&
        card.lastProcessedHash !== duplicate.stateHash
      ) {
        return { card, wake: this.decideWake(card, duplicate.delta) };
      }
      return {
        card,
        wake: {
          shouldWake: false,
          reason: "idempotent",
          delta: duplicate.delta,
        },
      };
    }

    const current = this.requireCard(cardId);
    const changed = change(current);
    const delta = cardDelta(current, changed);
    const now = this.dependencies.clock();
    const sequence = this.dependencies.cards.nextEventSequence(cardId);
    const changedHash = stateHash(changed);
    const pending = {
      ...changed,
      stateHash: changedHash,
      lastProcessedHash: current.lastProcessedHash,
      lastProcessedCursor: current.lastProcessedCursor,
      updatedAt: now,
    };
    const wake = this.decideWake(pending, delta);
    const next = wake.shouldWake
      ? pending
      : {
          ...pending,
          lastProcessedHash: changedHash,
          lastProcessedCursor: sequence,
        };
    const event: KanbanCardEventRecord = {
      id: this.dependencies.createId(),
      cardId,
      sequence,
      kind,
      idempotencyKey,
      delta,
      stateHash: next.stateHash,
      occurredAt: now,
    };

    this.dependencies.cards.update(next);
    const appended = this.dependencies.cards.appendEvent(event);
    if (!appended.inserted) {
      const card = this.requireCard(cardId);
      return { card, wake: { shouldWake: false, reason: "idempotent", delta } };
    }
    return { card: next, wake };
  }

  acknowledgeWake(cardId: string, idempotencyKey: string): KanbanCardRecord {
    const event =
      this.dependencies.cards.findEventByIdempotencyKey(idempotencyKey);
    if (!event || event.cardId !== cardId) {
      throw new Error(
        `Kanban event ${idempotencyKey} was not found for ${cardId}`,
      );
    }
    this.dependencies.cards.markProcessed(
      cardId,
      event.stateHash,
      event.sequence,
      this.dependencies.clock(),
    );
    return this.requireCard(cardId);
  }

  private decideWake(
    card: KanbanCardRecord,
    delta: KanbanCardDelta,
  ): KanbanWakeDecision {
    if (!delta.stateChanged) {
      return { shouldWake: false, reason: "no_relevant_change", delta };
    }
    if (card.activationPolicy === "manual") {
      return { shouldWake: false, reason: "manual_policy", delta };
    }
    if (
      card.activationPolicy === "status_transition" &&
      !delta.statusChanged &&
      !delta.ownerChanged &&
      !delta.laneChanged
    ) {
      return { shouldWake: false, reason: "no_relevant_change", delta };
    }
    if (card.ownerKind !== "lane" || card.laneId === null) {
      return { shouldWake: false, reason: "human_owner", delta };
    }
    const lane = this.dependencies.lanes.findById(card.laneId);
    if (!lane || lane.taskId !== card.taskId) {
      return { shouldWake: false, reason: "lane_missing", delta };
    }
    return {
      shouldWake: true,
      reason:
        card.activationPolicy === "status_transition" && delta.statusChanged
          ? "status_transition"
          : "relevant_change",
      delta,
    };
  }

  private requireCard(cardId: string): KanbanCardRecord {
    const card = this.dependencies.cards.findById(cardId);
    if (!card) throw new Error(`Kanban card ${cardId} was not found`);
    return card;
  }
}

function createCard(
  input: CreateKanbanCardInput & { id: string; now: string },
): KanbanCardRecord {
  const card = {
    id: input.id,
    taskId: input.taskId ?? null,
    title: input.title,
    description: input.description,
    status: input.status ?? "backlog",
    ownerKind: input.ownerKind ?? "human",
    laneId: input.laneId ?? null,
    activationPolicy: input.activationPolicy ?? "manual",
    position: input.position ?? 0,
    createdAt: input.now,
    updatedAt: input.now,
  } satisfies Omit<
    KanbanCardRecord,
    "stateHash" | "lastProcessedHash" | "lastProcessedCursor"
  >;
  if (card.ownerKind === "human" && card.laneId !== null) {
    throw new Error("Human-owned cards cannot target a lane");
  }
  if (card.ownerKind === "lane" && card.laneId === null) {
    throw new Error("Lane-owned cards require a lane id");
  }
  const hash = stateHash(card);
  return {
    ...card,
    stateHash: hash,
    lastProcessedHash: hash,
    lastProcessedCursor: 1,
  };
}

function cardDelta(
  current: KanbanCardRecord,
  next: KanbanCardRecord,
): KanbanCardDelta {
  const statusChanged = current.status !== next.status;
  const ownerChanged = current.ownerKind !== next.ownerKind;
  const laneChanged = current.laneId !== next.laneId;
  return {
    stateChanged: stateHash(current) !== stateHash(next),
    statusChanged,
    ownerChanged,
    laneChanged,
  };
}

function stateHash(
  card: Pick<
    KanbanCardRecord,
    | "title"
    | "taskId"
    | "description"
    | "status"
    | "ownerKind"
    | "laneId"
    | "activationPolicy"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        activationPolicy: card.activationPolicy,
        description: card.description,
        laneId: card.laneId,
        ownerKind: card.ownerKind,
        status: card.status,
        taskId: card.taskId,
        title: card.title,
      }),
    )
    .digest("hex");
}

function emptyDelta(): KanbanCardDelta {
  return {
    stateChanged: false,
    statusChanged: false,
    ownerChanged: false,
    laneChanged: false,
  };
}

function rowToCard(row: CardRow): KanbanCardRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    status: row.status,
    ownerKind: row.owner_kind,
    laneId: row.lane_id,
    activationPolicy: row.activation_policy,
    position: row.position,
    stateHash: row.state_hash,
    lastProcessedHash: row.last_processed_hash,
    lastProcessedCursor: row.last_processed_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: CardEventRow): KanbanCardEventRecord {
  return {
    id: row.id,
    cardId: row.card_id,
    sequence: row.sequence,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    delta: JSON.parse(row.delta_json) as KanbanCardDelta,
    stateHash: row.state_hash,
    occurredAt: row.occurred_at,
  };
}
