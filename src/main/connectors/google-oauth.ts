import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { ConnectorCredential, OAuthCredential } from "./credential-vault";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_SCOPES = ["openid", "email", "https://mail.google.com/"];
const CALLBACK_PATH = "/oauth/google/callback";
const CALLBACK_TIMEOUT_MS = 3 * 60_000;
const REFRESH_WINDOW_MS = 2 * 60_000;

type JsonRecord = Record<string, unknown>;

interface GoogleDesktopClient {
  clientId: string;
  clientSecret?: string;
}

export interface GoogleOAuthProfile {
  email: string;
  displayName: string;
}

export interface GoogleOAuthAuthorization {
  profile: GoogleOAuthProfile;
  credential: OAuthCredential;
}

export class GoogleOAuthError extends Error {
  constructor(
    readonly code:
      | "invalid_client_file"
      | "invalid_callback"
      | "access_denied"
      | "token_exchange_failed"
      | "profile_failed"
      | "authorization_timeout",
    message: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export class GoogleOAuthRefreshRequiredError extends Error {
  constructor() {
    super("A autorização do Google expirou. Reconecte a conta para continuar.");
    this.name = "GoogleOAuthRefreshRequiredError";
  }
}

interface GoogleOAuthAuthorizerOptions {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<unknown>;
  now?: () => Date;
  readTextFile?: (filename: string) => Promise<string>;
}

export class GoogleOAuthAuthorizer {
  private readonly fetchRequest: typeof fetch;
  private readonly openInBrowser: (url: string) => Promise<unknown>;
  private readonly clock: () => Date;
  private readonly readTextFile: (filename: string) => Promise<string>;

  constructor(options: GoogleOAuthAuthorizerOptions = {}) {
    this.fetchRequest = options.fetch ?? fetch;
    this.openInBrowser =
      options.openExternal ??
      (() =>
        Promise.reject(
          new GoogleOAuthError(
            "access_denied",
            "Não foi possível abrir o login do Google.",
          ),
        ));
    this.clock = options.now ?? (() => new Date());
    this.readTextFile =
      options.readTextFile ?? ((filename) => readFile(filename, "utf8"));
  }

  async authorizeFromFile(
    filename: string,
    loginHint?: string,
  ): Promise<GoogleOAuthAuthorization> {
    const client = await this.readClientFile(filename);
    return this.authorize(client, loginHint);
  }

  async authorizeStored(
    credential: OAuthCredential,
    loginHint?: string,
  ): Promise<GoogleOAuthAuthorization> {
    if (!credential.google) {
      throw new GoogleOAuthError(
        "invalid_client_file",
        "Selecione o JSON de credenciais OAuth do tipo Aplicativo para computador.",
      );
    }
    return this.authorize(
      {
        clientId: credential.google.clientId,
        ...(credential.google.clientSecret
          ? { clientSecret: credential.google.clientSecret }
          : {}),
      },
      loginHint,
    );
  }

  private async readClientFile(filename: string): Promise<GoogleDesktopClient> {
    try {
      const parsed = JSON.parse(await this.readTextFile(filename)) as unknown;
      return parseDesktopClient(parsed);
    } catch (cause) {
      if (cause instanceof GoogleOAuthError) throw cause;
      throw new GoogleOAuthError(
        "invalid_client_file",
        "O JSON não é uma credencial OAuth válida do tipo Aplicativo para computador.",
      );
    }
  }

  private async authorize(
    client: GoogleDesktopClient,
    loginHint?: string,
  ): Promise<GoogleOAuthAuthorization> {
    const callback = await createCallbackListener();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: callback.redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(loginHint?.trim() ? { login_hint: loginHint.trim() } : {}),
    }).toString();

    try {
      const codePromise = callback.waitForCode(state);
      const [, code] = await Promise.all([
        this.openInBrowser(authorizationUrl.toString()),
        codePromise,
      ]);
      const tokens = await this.exchangeCode(
        client,
        code,
        verifier,
        callback.redirectUri,
      );
      const profile = await this.readProfile(tokens.accessToken);
      return {
        profile,
        credential: {
          version: 1,
          kind: "oauth",
          username: profile.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(
            this.clock().getTime() + tokens.expiresInSeconds * 1000,
          ).toISOString(),
          google: {
            clientId: client.clientId,
            ...(client.clientSecret
              ? { clientSecret: client.clientSecret }
              : {}),
            scopes: [...GMAIL_SCOPES],
          },
        },
      };
    } finally {
      await callback.close();
    }
  }

  private async exchangeCode(
    client: GoogleDesktopClient,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
  }> {
    let response: Response;
    try {
      response = await this.fetchRequest(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.clientId,
          ...(client.clientSecret
            ? { client_secret: client.clientSecret }
            : {}),
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }).toString(),
      });
      const payload = (await response.json()) as JsonRecord;
      if (
        !response.ok ||
        !nonEmptyString(payload.access_token) ||
        !nonEmptyString(payload.refresh_token) ||
        !positiveNumber(payload.expires_in)
      ) {
        throw new Error("invalid token response");
      }
      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresInSeconds: payload.expires_in,
      };
    } catch {
      throw new GoogleOAuthError(
        "token_exchange_failed",
        "O Google não concluiu a autorização. Tente conectar a conta novamente.",
      );
    }
  }

  private async readProfile(accessToken: string): Promise<GoogleOAuthProfile> {
    try {
      const response = await this.fetchRequest(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json()) as JsonRecord;
      if (
        !response.ok ||
        !nonEmptyString(payload.email) ||
        payload.email_verified !== true
      ) {
        throw new Error("invalid profile response");
      }
      return {
        email: payload.email.trim().toLowerCase(),
        displayName: nonEmptyString(payload.name)
          ? payload.name.trim()
          : payload.email.split("@")[0]!,
      };
    } catch {
      throw new GoogleOAuthError(
        "profile_failed",
        "Não foi possível confirmar qual Conta Google autorizou o acesso.",
      );
    }
  }
}

interface CredentialStore {
  set(accountId: string, credential: ConnectorCredential): Promise<void>;
  get(accountId: string): Promise<ConnectorCredential | null>;
  has(accountId: string): Promise<boolean>;
  delete(accountId: string): Promise<void>;
}

interface RefreshingCredentialVaultOptions {
  fetch?: typeof fetch;
  now?: () => Date;
}

export class RefreshingCredentialVault implements CredentialStore {
  private readonly fetchRequest: typeof fetch;
  private readonly clock: () => Date;
  private readonly inFlight = new Map<
    string,
    Promise<ConnectorCredential | null>
  >();

  constructor(
    private readonly backing: CredentialStore,
    options: RefreshingCredentialVaultOptions = {},
  ) {
    this.fetchRequest = options.fetch ?? fetch;
    this.clock = options.now ?? (() => new Date());
  }

  set(accountId: string, credential: ConnectorCredential): Promise<void> {
    return this.backing.set(accountId, credential);
  }

  has(accountId: string): Promise<boolean> {
    return this.backing.has(accountId);
  }

  delete(accountId: string): Promise<void> {
    return this.backing.delete(accountId);
  }

  get(accountId: string): Promise<ConnectorCredential | null> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    const operation = this.getFresh(accountId).finally(() => {
      this.inFlight.delete(accountId);
    });
    this.inFlight.set(accountId, operation);
    return operation;
  }

  private async getFresh(
    accountId: string,
  ): Promise<ConnectorCredential | null> {
    const credential = await this.backing.get(accountId);
    if (!needsGoogleRefresh(credential, this.clock())) return credential;
    const refreshed = await refreshGoogleCredential(
      credential,
      this.fetchRequest,
      this.clock,
    );
    await this.backing.set(accountId, refreshed);
    return refreshed;
  }
}

function parseDesktopClient(value: unknown): GoogleDesktopClient {
  if (!plainRecord(value) || !plainRecord(value.installed)) {
    throw new GoogleOAuthError(
      "invalid_client_file",
      "Use o JSON de uma credencial OAuth do tipo Aplicativo para computador.",
    );
  }
  const installed = value.installed;
  if (
    !nonEmptyString(installed.client_id) ||
    !installed.client_id.endsWith(".apps.googleusercontent.com") ||
    installed.token_uri !== GOOGLE_TOKEN_ENDPOINT ||
    !nonEmptyString(installed.auth_uri) ||
    new URL(installed.auth_uri).hostname !== "accounts.google.com" ||
    (installed.client_secret !== undefined &&
      !nonEmptyString(installed.client_secret))
  ) {
    throw new GoogleOAuthError(
      "invalid_client_file",
      "O JSON não contém um cliente OAuth Desktop válido do Google.",
    );
  }
  return {
    clientId: installed.client_id,
    ...(nonEmptyString(installed.client_secret)
      ? { clientSecret: installed.client_secret }
      : {}),
  };
}

function needsGoogleRefresh(
  credential: ConnectorCredential | null,
  now: Date,
): credential is OAuthCredential & {
  refreshToken: string;
  expiresAt: string;
  google: NonNullable<OAuthCredential["google"]>;
} {
  if (
    !credential ||
    credential.kind !== "oauth" ||
    !credential.google ||
    !nonEmptyString(credential.refreshToken) ||
    !nonEmptyString(credential.expiresAt)
  ) {
    return false;
  }
  const expiresAt = Date.parse(credential.expiresAt);
  return (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() + REFRESH_WINDOW_MS
  );
}

async function refreshGoogleCredential(
  credential: OAuthCredential & {
    refreshToken: string;
    google: NonNullable<OAuthCredential["google"]>;
  },
  fetchRequest: typeof fetch,
  clock: () => Date,
): Promise<OAuthCredential> {
  try {
    const response = await fetchRequest(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credential.google.clientId,
        ...(credential.google.clientSecret
          ? { client_secret: credential.google.clientSecret }
          : {}),
        refresh_token: credential.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const payload = (await response.json()) as JsonRecord;
    if (
      !response.ok ||
      !nonEmptyString(payload.access_token) ||
      !positiveNumber(payload.expires_in)
    ) {
      throw new Error("invalid refresh response");
    }
    return {
      ...credential,
      accessToken: payload.access_token,
      refreshToken: nonEmptyString(payload.refresh_token)
        ? payload.refresh_token
        : credential.refreshToken,
      expiresAt: new Date(
        clock().getTime() + payload.expires_in * 1000,
      ).toISOString(),
    };
  } catch {
    throw new GoogleOAuthRefreshRequiredError();
  }
}

interface CallbackListener {
  redirectUri: string;
  waitForCode(expectedState: string): Promise<string>;
  close(): Promise<void>;
}

async function createCallbackListener(): Promise<CallbackListener> {
  let expectedState = "";
  let resolveCode: ((code: string) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;
  let settled = false;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const receivedState = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    const oauthError = requestUrl.searchParams.get("error");
    if (
      !expectedState ||
      receivedState !== expectedState ||
      (!code && !oauthError)
    ) {
      settled = true;
      response
        .writeHead(400, { "content-type": "text/html; charset=utf-8" })
        .end(callbackPage("Não foi possível validar este retorno do Google."));
      rejectCode?.(
        new GoogleOAuthError(
          "invalid_callback",
          "O retorno do Google não pôde ser validado. Tente novamente.",
        ),
      );
      return;
    }
    settled = true;
    if (oauthError) {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          callbackPage(
            "A autorização foi cancelada. Você pode fechar esta aba.",
          ),
        );
      rejectCode?.(
        new GoogleOAuthError(
          "access_denied",
          "A autorização do Google foi cancelada.",
        ),
      );
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(callbackPage("Conta conectada. Você já pode voltar ao Okami."));
    resolveCode?.(code!);
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new GoogleOAuthError(
      "invalid_callback",
      "Não foi possível iniciar o retorno seguro do Google.",
    );
  }
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode?.(
      new GoogleOAuthError(
        "authorization_timeout",
        "O login do Google expirou. Inicie a conexão novamente.",
      ),
    );
  }, CALLBACK_TIMEOUT_MS);
  timeout.unref();
  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    waitForCode(state) {
      expectedState = state;
      return codePromise;
    },
    async close() {
      clearTimeout(timeout);
      await closeServer(server);
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function callbackPage(message: string): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Okami</title><body style="margin:0;background:#111116;color:#f5f3ef;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:40px;border:1px solid #34343d;border-radius:24px;background:#19191f"><strong style="color:#ff7a1a">OKAMI</strong><h1 style="font-size:28px">Autorização do Google</h1><p style="color:#b7b5be;line-height:1.6">${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character]!;
  });
}

function plainRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
