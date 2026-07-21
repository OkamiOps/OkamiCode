import nodemailer from "nodemailer";
import type { ConnectorCredential } from "../connectors/credential-vault";
import type { OutgoingSettings } from "./outgoing-settings-service";

export interface SmtpReplyMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

export interface SmtpSendReceipt {
  messageId: string | null;
  acceptedCount: number;
  rejectedCount: number;
}

export interface SmtpReplyTransport {
  send(message: SmtpReplyMessage): Promise<unknown>;
}

export interface SmtpReplyTransportFactory {
  create(input: {
    settings: Pick<OutgoingSettings, "host" | "port" | "secure">;
    credential: ConnectorCredential;
  }): SmtpReplyTransport;
}

interface NodemailerTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  auth:
    | { user: string; pass: string }
    | { type: "OAuth2"; user: string; accessToken: string };
}

interface NodemailerClient {
  sendMail(message: SmtpReplyMessage): Promise<{
    messageId?: unknown;
    accepted?: unknown;
    rejected?: unknown;
  }>;
}

export interface NodemailerModule {
  createTransport(options: NodemailerTransportOptions): NodemailerClient;
}

export interface CreateSmtpReplyTransportInput {
  settings: Pick<OutgoingSettings, "host" | "port" | "secure">;
  credential: ConnectorCredential;
  nodemailer?: NodemailerModule;
}

export function createSmtpReplyTransport({
  settings,
  credential,
  nodemailer: nodemailerModule = nodemailer as unknown as NodemailerModule,
}: CreateSmtpReplyTransportInput): SmtpReplyTransport {
  const client = nodemailerModule.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    auth:
      credential.kind === "imap_password"
        ? { user: credential.username, pass: credential.password }
        : {
            type: "OAuth2",
            user: credential.username,
            accessToken: credential.accessToken,
          },
  });
  return {
    async send(message) {
      const receipt = await client.sendMail(message);
      return {
        messageId:
          typeof receipt.messageId === "string" && receipt.messageId.length > 0
            ? receipt.messageId
            : null,
        acceptedCount: Array.isArray(receipt.accepted)
          ? receipt.accepted.length
          : 0,
        rejectedCount: Array.isArray(receipt.rejected)
          ? receipt.rejected.length
          : 0,
      };
    },
  };
}

export const smtpReplyTransportFactory: SmtpReplyTransportFactory = {
  create: createSmtpReplyTransport,
};
