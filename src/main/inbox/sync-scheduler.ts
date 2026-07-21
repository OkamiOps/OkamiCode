import type { InboxAccountSummary } from "./application-service";

interface SyncSchedulerInbox {
  listAccounts(): Promise<InboxAccountSummary[]>;
  syncAccount(accountId: string): Promise<unknown>;
}

interface InboxSyncSchedulerOptions {
  initialDelayMs?: number;
  intervalMs?: number;
  reportError?: (error: unknown, account?: InboxAccountSummary) => void;
}

const DEFAULT_INITIAL_DELAY_MS = 5_000;
const DEFAULT_INTERVAL_MS = 60_000;

export class InboxSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;

  constructor(
    private readonly inbox: SyncSchedulerInbox,
    private readonly options: InboxSyncSchedulerOptions = {},
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(this.options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let accounts: InboxAccountSummary[];
      try {
        accounts = await this.inbox.listAccounts();
      } catch (error) {
        this.options.reportError?.(error);
        return;
      }
      for (const account of accounts) {
        if (!isEligible(account)) continue;
        try {
          await this.inbox.syncAccount(account.account.id);
        } catch (error) {
          this.options.reportError?.(error, account);
        }
      }
    } finally {
      this.running = false;
      this.schedule(this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    }
  }
}

function isEligible(summary: InboxAccountSummary): boolean {
  return (
    summary.hasCredential &&
    (summary.account.status === "connected" ||
      summary.account.status === "degraded")
  );
}
