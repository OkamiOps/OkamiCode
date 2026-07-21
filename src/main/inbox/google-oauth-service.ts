import type {
  ConnectorCredential,
  OAuthCredential,
} from "../connectors/credential-vault";
import type {
  GoogleOAuthAuthorization,
  GoogleOAuthAuthorizer,
} from "../connectors/google-oauth";
import type {
  AddImapAccountInput,
  InboxAccountSummary,
  InboxSyncResult,
} from "./application-service";

interface GoogleOAuthAuthorizerApi {
  authorizeFromFile(
    filename: string,
    loginHint?: string,
  ): Promise<GoogleOAuthAuthorization>;
  authorizeStored(
    credential: OAuthCredential,
    loginHint?: string,
  ): Promise<GoogleOAuthAuthorization>;
}

interface GoogleInboxApi {
  addImapAccount(input: AddImapAccountInput): Promise<InboxAccountSummary>;
  listAccounts(): Promise<InboxAccountSummary[]>;
  updateCredentialAndSync(
    accountId: string,
    credential: ConnectorCredential,
  ): Promise<InboxSyncResult>;
}

interface GoogleCredentialReader {
  get(accountId: string): Promise<ConnectorCredential | null>;
}

interface GoogleInboxOAuthServiceOptions {
  authorizer: GoogleOAuthAuthorizerApi | GoogleOAuthAuthorizer;
  inbox: GoogleInboxApi;
  vault: GoogleCredentialReader;
  pickClientFile: () => Promise<string | null>;
}

export class GoogleInboxOAuthService {
  constructor(private readonly options: GoogleInboxOAuthServiceOptions) {}

  async connectGmail(): Promise<InboxAccountSummary> {
    const filename = await this.requireClientFile();
    const authorization =
      await this.options.authorizer.authorizeFromFile(filename);
    return this.options.inbox.addImapAccount({
      provider: "gmail",
      displayName: authorization.profile.displayName,
      address: authorization.profile.email,
      configuration: {
        host: "imap.gmail.com",
        port: 993,
        secure: true,
      },
      credential: authorization.credential,
    });
  }

  async reauthorizeGmail(accountId: string): Promise<InboxSyncResult> {
    const summary = (await this.options.inbox.listAccounts()).find(
      (candidate) => candidate.account.id === accountId,
    );
    if (!summary || summary.account.provider !== "gmail") {
      throw new Error("A Conta Google não foi encontrada.");
    }
    const current = await this.options.vault.get(accountId);
    const authorization =
      current?.kind === "oauth" && current.google
        ? await this.options.authorizer.authorizeStored(
            current,
            summary.account.address,
          )
        : await this.options.authorizer.authorizeFromFile(
            await this.requireClientFile(),
            summary.account.address,
          );
    if (
      authorization.profile.email.trim().toLowerCase() !==
      summary.account.address.trim().toLowerCase()
    ) {
      throw new Error(
        `Você autorizou outra Conta Google (${authorization.profile.email}). Entre com ${summary.account.address}.`,
      );
    }
    return this.options.inbox.updateCredentialAndSync(
      accountId,
      authorization.credential,
    );
  }

  private async requireClientFile(): Promise<string> {
    const filename = await this.options.pickClientFile();
    if (!filename) throw new Error("A conexão com o Google foi cancelada.");
    return filename;
  }
}
