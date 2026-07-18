import { describe, expect, it } from "vitest";
import { createChatGptBridge, type ChatGptBackend } from "./bridges/chatgpt";
import { createGatewayProfile } from "./profile";
import { startGatewayServer } from "./server";

const profile = createGatewayProfile({
  id: "chatgpt-test",
  provider: "chatgpt",
  kind: "bridged",
  env: { CODEX_HOME: "/tmp/okami-codex" },
  displayQuotaAccount: "ChatGPT Test",
});

describe("SubscriptionGatewayServer", () => {
  it("binds to loopback and requires its per-session bearer token", async () => {
    const requests: unknown[] = [];
    const backend: ChatGptBackend = {
      async *stream(request) {
        requests.push(request);
        yield {
          type: "response.completed",
          response: { usage: { output_tokens: 0 } },
        };
      },
    };
    const gateway = await startGatewayServer({
      bearerToken: "session-token",
      profiles: [
        {
          profile,
          bridge: createChatGptBridge(backend, { model: "gpt-5.6-sol" }),
        },
      ],
    });
    try {
      expect(gateway.host).toBe("127.0.0.1");
      expect(gateway.baseUrl).toBe(`http://127.0.0.1:${gateway.port}`);
      const url = `${gateway.baseUrl}/${profile.id}/v1/messages`;
      const request = { model: "gpt-5.2", messages: [] };

      expect(
        await fetch(url, { method: "POST", body: JSON.stringify(request) }),
      ).toMatchObject({ status: 401 });
      expect(
        await fetch(url, {
          method: "POST",
          headers: { Authorization: "Bearer wrong-token" },
          body: JSON.stringify(request),
        }),
      ).toMatchObject({ status: 401 });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(await response.text()).toContain("event: message_stop");
      expect(requests).toHaveLength(1);
    } finally {
      await gateway.close();
    }
  });

  it("mounts only the configured profile path", async () => {
    const backend: ChatGptBackend = {
      async *stream() {
        yield { type: "response.completed" };
      },
    };
    const gateway = await startGatewayServer({
      bearerToken: "session-token",
      profiles: [
        {
          profile,
          bridge: createChatGptBridge(backend, { model: "gpt-5.6-sol" }),
        },
      ],
    });
    try {
      const response = await fetch(`${gateway.baseUrl}/other/v1/messages`, {
        method: "POST",
        headers: { Authorization: "Bearer session-token" },
        body: "{}",
      });
      expect(response.status).toBe(404);
    } finally {
      await gateway.close();
    }
  });

  it("returns bridge_unhealthy without switching provider", async () => {
    const backend: ChatGptBackend = {
      stream() {
        throw new Error("refresh failed");
      },
    };
    const gateway = await startGatewayServer({
      bearerToken: "session-token",
      profiles: [
        {
          profile,
          bridge: createChatGptBridge(backend, { model: "gpt-5.6-sol" }),
        },
      ],
    });
    try {
      const response = await fetch(
        `${gateway.baseUrl}/${profile.id}/v1/messages`,
        {
          method: "POST",
          headers: { Authorization: "Bearer session-token" },
          body: JSON.stringify({ model: "gpt-5.2", messages: [] }),
        },
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { type: "bridge_unhealthy" },
      });
    } finally {
      await gateway.close();
    }
  });
});
