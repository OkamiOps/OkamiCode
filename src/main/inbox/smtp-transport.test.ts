import { describe, expect, it, vi } from "vitest";
import {
  createSmtpReplyTransport,
  type NodemailerModule,
} from "./smtp-transport";

describe("createSmtpReplyTransport", () => {
  it("maps password credentials and reply headers without network access", async () => {
    const sendMail = vi.fn(async () => ({
      messageId: "<message@example.com>",
      accepted: ["client@example.com"],
      rejected: [],
    }));
    const createTransport = vi.fn(() => ({ sendMail }));
    const transport = createSmtpReplyTransport({
      nodemailer: { createTransport } as NodemailerModule,
      settings: { host: "smtp.example.com", port: 465, secure: true },
      credential: {
        version: 1,
        kind: "imap_password",
        username: "me@example.com",
        password: "secret",
      },
    });

    await expect(
      transport.send({
        from: "me@example.com",
        to: ["client@example.com"],
        subject: "Re: Proposal",
        text: "Thanks",
        html: "<p><strong>Thanks</strong></p>",
        inReplyTo: "<incoming@example.com>",
        references: "<incoming@example.com>",
      }),
    ).resolves.toEqual({
      messageId: "<message@example.com>",
      acceptedCount: 1,
      rejectedCount: 0,
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: { user: "me@example.com", pass: "secret" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "me@example.com",
      to: ["client@example.com"],
      subject: "Re: Proposal",
      text: "Thanks",
      html: "<p><strong>Thanks</strong></p>",
      inReplyTo: "<incoming@example.com>",
      references: "<incoming@example.com>",
    });
  });

  it("maps OAuth credentials with the authenticated user and access token", () => {
    const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));
    createSmtpReplyTransport({
      nodemailer: { createTransport } as NodemailerModule,
      settings: { host: "smtp.example.com", port: 587, secure: false },
      credential: {
        version: 1,
        kind: "oauth",
        username: "me@example.com",
        accessToken: "access-token",
      },
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          type: "OAuth2",
          user: "me@example.com",
          accessToken: "access-token",
        },
      }),
    );
  });
});
