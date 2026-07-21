import { describe, expect, it, vi } from "vitest";
import type { OAuthCredential } from "../connectors/credential-vault";
import { GoogleInboxOAuthService } from "./google-oauth-service";

const googleCredential: OAuthCredential = {
  version: 1,
  kind: "oauth",
  username: "marcos@gmail.com",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: "2026-07-21T13:00:00.000Z",
  google: {
    clientId: "desktop.apps.googleusercontent.com",
    clientSecret: "client-secret",
    scopes: ["openid", "email", "https://mail.google.com/"],
  },
};

const authorization = {
  profile: { email: "marcos@gmail.com", displayName: "Marcos Vinicius" },
  credential: googleCredential,
};

const gmailSummary = {
  account: {
    id: "gmail-account",
    provider: "gmail" as const,
    displayName: "Pessoal",
    address: "marcos@gmail.com",
    status: "connected" as const,
    syncCursor: null,
    lastError: null,
    lastSyncedAt: null,
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  },
  configuration: {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    mailbox: "INBOX",
    maxInitialMessages: 100,
    maxMessageBytes: 2_097_152,
  },
  hasCredential: true,
};

describe("GoogleInboxOAuthService", () => {
  it("creates Gmail with official endpoints after importing and authorizing a Desktop JSON", async () => {
    const inbox = {
      addImapAccount: vi.fn(async (input) => input),
      listAccounts: vi.fn(async () => []),
      updateCredentialAndSync: vi.fn(),
    };
    const service = new GoogleInboxOAuthService({
      authorizer: {
        authorizeFromFile: vi.fn(async () => authorization),
        authorizeStored: vi.fn(),
      },
      inbox,
      vault: { get: vi.fn() },
      pickClientFile: vi.fn(async () => "/private/client-secret.json"),
    });

    await service.connectGmail();

    expect(inbox.addImapAccount).toHaveBeenCalledWith({
      provider: "gmail",
      displayName: "Marcos Vinicius",
      address: "marcos@gmail.com",
      configuration: {
        host: "imap.gmail.com",
        port: 993,
        secure: true,
      },
      credential: googleCredential,
    });
  });

  it("reuses the encrypted Desktop client when reconnecting an OAuth account", async () => {
    const inbox = {
      addImapAccount: vi.fn(),
      listAccounts: vi.fn(async () => [gmailSummary]),
      updateCredentialAndSync: vi.fn(async () => ({
        account: gmailSummary.account,
        counts: { inserted: 1, updated: 0, unchanged: 0 },
      })),
    };
    const authorizeStored = vi.fn(async () => authorization);
    const pickClientFile = vi.fn();
    const service = new GoogleInboxOAuthService({
      authorizer: {
        authorizeFromFile: vi.fn(),
        authorizeStored,
      },
      inbox,
      vault: { get: vi.fn(async () => googleCredential) },
      pickClientFile,
    });

    await service.reauthorizeGmail("gmail-account");

    expect(authorizeStored).toHaveBeenCalledWith(
      googleCredential,
      "marcos@gmail.com",
    );
    expect(pickClientFile).not.toHaveBeenCalled();
    expect(inbox.updateCredentialAndSync).toHaveBeenCalledWith(
      "gmail-account",
      googleCredential,
    );
  });

  it("never replaces an account with authorization from a different Google email", async () => {
    const inbox = {
      addImapAccount: vi.fn(),
      listAccounts: vi.fn(async () => [gmailSummary]),
      updateCredentialAndSync: vi.fn(),
    };
    const service = new GoogleInboxOAuthService({
      authorizer: {
        authorizeFromFile: vi.fn(),
        authorizeStored: vi.fn(async () => ({
          ...authorization,
          profile: {
            email: "outra-conta@gmail.com",
            displayName: "Outra conta",
          },
        })),
      },
      inbox,
      vault: { get: vi.fn(async () => googleCredential) },
      pickClientFile: vi.fn(),
    });

    await expect(service.reauthorizeGmail("gmail-account")).rejects.toThrow(
      /outra Conta Google/i,
    );
    expect(inbox.updateCredentialAndSync).not.toHaveBeenCalled();
  });
});
