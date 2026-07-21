import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/connection";
import { createTestDatabase } from "../db/test-support";
import { InboxService } from "./service";
import {
  InboxOutgoingSettingsAccountNotFoundError,
  InboxOutgoingSettingsService,
} from "./outgoing-settings-service";

const createdAt = "2026-07-21T12:00:00.000Z";
const updatedAt = "2026-07-21T12:05:00.000Z";

function harness() {
  const fixture = createTestDatabase();
  const account = new InboxService(fixture.db).addAccount({
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
  });
  let now = createdAt;
  const createService = () =>
    new InboxOutgoingSettingsService({
      db: fixture.db,
      clock: () => now,
    });
  return {
    fixture,
    account,
    createService,
    advanceClock: () => {
      now = updatedAt;
    },
  };
}

function sharedHarness() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "okami-outgoing-settings-")),
    "outgoing-settings.db",
  );
  const key = Buffer.alloc(32, 6);
  const firstDb = openDatabase(file, key);
  const secondDb = openDatabase(file, key);
  const account = new InboxService(firstDb).addAccount({
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
  });
  return {
    account,
    first: new InboxOutgoingSettingsService({
      db: firstDb,
      clock: () => createdAt,
    }),
    second: new InboxOutgoingSettingsService({
      db: secondDb,
      clock: () => updatedAt,
    }),
    firstDb,
    secondDb,
    close() {
      firstDb.close();
      secondDb.close();
    },
  };
}

describe("InboxOutgoingSettingsService", () => {
  it("normalizes and upserts outgoing settings while preserving creation time", () => {
    const { account, createService, advanceClock } = harness();
    const service = createService();

    expect(
      service.save({
        accountId: account.id,
        host: "  SMTP.Example.COM  ",
        port: 465,
        secure: true,
        fromAddresses: [
          " Contato@Example.com ",
          "me@example.com",
          "contato@example.com",
        ],
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      fromAddresses: ["contato@example.com"],
      createdAt,
      updatedAt: createdAt,
    });

    advanceClock();
    expect(
      service.save({
        accountId: account.id,
        host: "relay.example.com",
        port: 587,
        secure: false,
      }),
    ).toEqual({
      host: "relay.example.com",
      port: 587,
      secure: false,
      fromAddresses: [],
      createdAt,
      updatedAt,
    });
    expect(service.get(account.id)).toEqual({
      host: "relay.example.com",
      port: 587,
      secure: false,
      fromAddresses: [],
      createdAt,
      updatedAt,
    });
  });

  it("rejects a missing account without exposing database details", () => {
    const { createService } = harness();

    expect(() =>
      createService().save({
        accountId: randomUUID(),
        host: "smtp.example.com",
        port: 587,
        secure: false,
      }),
    ).toThrow(InboxOutgoingSettingsAccountNotFoundError);
  });

  it("keeps one row across SQLite connections and preserves the original creation time", () => {
    const shared = sharedHarness();
    try {
      const first = shared.first.save({
        accountId: shared.account.id,
        host: "smtp.example.com",
        port: 587,
        secure: false,
      });
      expect(shared.second.get(shared.account.id)).toEqual(first);

      const latest = shared.second.save({
        accountId: shared.account.id,
        host: "relay.example.com",
        port: 465,
        secure: true,
        fromAddresses: [],
      });

      expect(latest).toEqual({
        host: "relay.example.com",
        port: 465,
        secure: true,
        fromAddresses: [],
        createdAt,
        updatedAt,
      });
      expect(shared.first.get(shared.account.id)).toEqual(latest);
      for (const db of [shared.firstDb, shared.secondDb]) {
        expect(
          db
            .prepare("SELECT count(*) FROM inbox_outgoing_settings")
            .pluck()
            .get(),
        ).toBe(1);
      }
    } finally {
      shared.close();
    }
  });
});
