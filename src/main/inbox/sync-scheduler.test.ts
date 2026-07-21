import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxSyncScheduler } from "./sync-scheduler";
import type { InboxAccountSummary } from "./application-service";

function account(
  id: string,
  status: "connected" | "degraded" | "auth_required" = "connected",
  hasCredential = true,
): InboxAccountSummary {
  return {
    account: { id, status },
    hasCredential,
  } as InboxAccountSummary;
}

describe("InboxSyncScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("synchronizes eligible accounts automatically and keeps polling", async () => {
    vi.useFakeTimers();
    const inbox = {
      listAccounts: vi.fn(async () => [
        account("connected"),
        account("degraded", "degraded"),
        account("auth", "auth_required"),
        account("missing", "connected", false),
      ]),
      syncAccount: vi.fn(async (accountId: string) => void accountId),
    };
    const scheduler = new InboxSyncScheduler(inbox, {
      initialDelayMs: 10,
      intervalMs: 100,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(inbox.syncAccount.mock.calls.map(([id]) => id)).toEqual([
      "connected",
      "degraded",
    ]);

    await vi.advanceTimersByTimeAsync(100);
    expect(inbox.syncAccount).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });

  it("does not overlap cycles and stops scheduling new work", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inbox = {
      listAccounts: vi.fn(async () => [account("one")]),
      syncAccount: vi.fn((accountId: string) => {
        void accountId;
        return pending;
      }),
    };
    const scheduler = new InboxSyncScheduler(inbox, {
      initialDelayMs: 1,
      intervalMs: 10,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(inbox.syncAccount).toHaveBeenCalledOnce();

    release();
    await pending;
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(inbox.syncAccount).toHaveBeenCalledOnce();
  });
});
