import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleOAuthAuthorizer,
  GoogleOAuthError,
  RefreshingCredentialVault,
} from "./google-oauth";
import type { ConnectorCredential } from "./credential-vault";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function clientJson(contents: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-google-oauth-"));
  temporaryDirectories.push(directory);
  const filename = path.join(directory, "client-secret.json");
  await writeFile(filename, JSON.stringify(contents), { mode: 0o600 });
  return filename;
}

const installedClient = {
  installed: {
    client_id: "desktop-client.apps.googleusercontent.com",
    project_id: "okami-local",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    client_secret: "desktop-client-secret",
    redirect_uris: ["http://localhost"],
  },
};

describe("GoogleOAuthAuthorizer", () => {
  it("imports a Desktop app JSON and completes PKCE through the system browser", async () => {
    const filename = await clientJson(installedClient);
    const fetchRequest = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        void init;
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(
            JSON.stringify({
              access_token: "google-access-token",
              refresh_token: "google-refresh-token",
              expires_in: 3600,
              scope: "openid email https://mail.google.com/",
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
          return new Response(
            JSON.stringify({
              email: "marcos@gmail.com",
              email_verified: true,
              name: "Marcos Vinicius",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected request: ${url}`);
      },
    );
    const openExternal = vi.fn(async (authorizationUrl: string) => {
      const request = new URL(authorizationUrl);
      expect(request.origin).toBe("https://accounts.google.com");
      expect(request.searchParams.get("code_challenge_method")).toBe("S256");
      expect(request.searchParams.get("access_type")).toBe("offline");
      expect(request.searchParams.get("prompt")).toBe("consent");
      expect(request.searchParams.get("scope")).toContain(
        "https://mail.google.com/",
      );
      const redirect = new URL(request.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", "authorization-code");
      redirect.searchParams.set("state", request.searchParams.get("state")!);
      await fetch(redirect);
    });
    const authorizer = new GoogleOAuthAuthorizer({
      fetch: fetchRequest as typeof fetch,
      openExternal,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    const result = await authorizer.authorizeFromFile(filename);

    expect(result.profile).toEqual({
      email: "marcos@gmail.com",
      displayName: "Marcos Vinicius",
    });
    expect(result.credential).toEqual({
      version: 1,
      kind: "oauth",
      username: "marcos@gmail.com",
      accessToken: "google-access-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2026-07-21T13:00:00.000Z",
      google: {
        clientId: "desktop-client.apps.googleusercontent.com",
        clientSecret: "desktop-client-secret",
        scopes: ["openid", "email", "https://mail.google.com/"],
      },
    });
    const tokenCall = fetchRequest.mock.calls.find(
      ([input]) => String(input) === "https://oauth2.googleapis.com/token",
    );
    expect(String(tokenCall?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(tokenCall?.[1]?.body)).toContain("code_verifier=");
  });

  it("rejects web-client JSON and never opens the browser", async () => {
    const filename = await clientJson({
      web: installedClient.installed,
    });
    const openExternal = vi.fn();
    const authorizer = new GoogleOAuthAuthorizer({ openExternal });

    await expect(authorizer.authorizeFromFile(filename)).rejects.toMatchObject({
      code: "invalid_client_file",
    } satisfies Partial<GoogleOAuthError>);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state does not match before exchanging tokens", async () => {
    const filename = await clientJson(installedClient);
    const fetchRequest = vi.fn();
    const authorizer = new GoogleOAuthAuthorizer({
      fetch: fetchRequest as typeof fetch,
      openExternal: async (authorizationUrl) => {
        const request = new URL(authorizationUrl);
        const redirect = new URL(request.searchParams.get("redirect_uri")!);
        redirect.searchParams.set("code", "authorization-code");
        redirect.searchParams.set("state", "attacker-state");
        await fetch(redirect);
      },
    });

    await expect(authorizer.authorizeFromFile(filename)).rejects.toMatchObject({
      code: "invalid_callback",
    } satisfies Partial<GoogleOAuthError>);
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

describe("RefreshingCredentialVault", () => {
  it("refreshes an expiring Google access token once and persists the replacement", async () => {
    const credential: ConnectorCredential = {
      version: 1,
      kind: "oauth",
      username: "marcos@gmail.com",
      accessToken: "expired-access-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2026-07-21T12:00:30.000Z",
      google: {
        clientId: "desktop-client.apps.googleusercontent.com",
        clientSecret: "desktop-client-secret",
        scopes: ["openid", "email", "https://mail.google.com/"],
      },
    };
    const backing = {
      get: vi.fn(async () => credential),
      set: vi.fn(async () => undefined),
      has: vi.fn(async () => true),
      delete: vi.fn(async () => undefined),
    };
    const fetchRequest = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            expires_in: 3600,
            scope: "openid email https://mail.google.com/",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const vault = new RefreshingCredentialVault(backing, {
      fetch: fetchRequest as typeof fetch,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      vault.get("gmail-account"),
      vault.get("gmail-account"),
    ]);

    expect(first).toMatchObject({
      accessToken: "fresh-access-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2026-07-21T13:00:00.000Z",
    });
    expect(second).toEqual(first);
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(backing.set).toHaveBeenCalledWith("gmail-account", first);
  });
});
