import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  disconnectAccountConnector,
  getAccountConnectorStatus,
  getStoredAccountConnector,
  listAccountConnectorStatuses,
  storeAccountConnectorToken,
  updateAccountConnectorConfig,
} from "../../src/core/account-connectors/store";
import {
  revokeAccountConnector,
  startAccountConnectorOAuth,
} from "../../src/core/account-connectors/oauth";
import {
  calendarCreate,
  calendarList,
  gmailSearch,
  gmailSend,
} from "../../src/core/account-connectors/client";
import { isSealedSecret } from "../../src/core/secret-storage";
import { getToolSchemasForLLM } from "../../src/core/tools";

const originalFetch = globalThis.fetch;
const originalRuntimePort = process.env.CYBARA_RUNTIME_PORT;

afterEach(() => {
  config.set("account_connectors", null);
  globalThis.fetch = originalFetch;
  if (originalRuntimePort === undefined) delete process.env.CYBARA_RUNTIME_PORT;
  else process.env.CYBARA_RUNTIME_PORT = originalRuntimePort;
});

describe("account connectors", () => {
  test("stores credentials and tokens encrypted while returning safe status", () => {
    updateAccountConnectorConfig("google_workspace", {
      clientId: "google-client",
      clientSecret: "google-secret",
      access: "read_write",
    });
    storeAccountConnectorToken(
      "google_workspace",
      {
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        expiresAt: Date.now() + 60_000,
        scopes: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/calendar.events",
        ],
      },
      "person@example.com"
    );

    const raw = config.get<{
      google_workspace: Record<string, string>;
    }>("account_connectors");
    expect(isSealedSecret(raw?.google_workspace.clientSecret)).toBe(true);
    expect(isSealedSecret(raw?.google_workspace.accessToken)).toBe(true);
    expect(isSealedSecret(raw?.google_workspace.refreshToken)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("access-secret");
    expect(getStoredAccountConnector("google_workspace").accessToken).toBe("access-secret");
    expect(getAccountConnectorStatus("google_workspace")).toMatchObject({
      configured: true,
      connected: true,
      access: "read_write",
      account: "person@example.com",
      needsReauthorization: false,
    });
  });

  test("clears authorization when credentials or requested access change", () => {
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app", access: "read" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "token",
      refreshToken: "refresh",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });

    const changed = updateAccountConnectorConfig("dropbox", { access: "read_write" });

    expect(changed.connected).toBe(false);
    expect(getStoredAccountConnector("dropbox").refreshToken).toBeUndefined();
    expect(changed.access).toBe("read_write");
  });

  test("creates state-bound PKCE authorization URLs without leaking secrets", () => {
    config.set("port", 4269);
    updateAccountConnectorConfig("google_workspace", {
      clientId: "google-client",
      clientSecret: "private-secret",
    });

    const started = startAccountConnectorOAuth("google_workspace");
    const url = new URL(started.authUrl);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe(started.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4269/api/connectors/oauth/callback"
    );
    expect(started.authUrl).not.toContain("private-secret");
  });

  test("uses the active gateway port for OAuth callbacks", () => {
    process.env.CYBARA_RUNTIME_PORT = "4307";
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app" });

    const started = startAccountConnectorOAuth("dropbox");

    expect(new URL(started.authUrl).searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4307/api/connectors/oauth/callback"
    );
  });

  test("reads Gmail search results through the configured account", async () => {
    updateAccountConnectorConfig("google_workspace", { clientId: "google-client" });
    storeAccountConnectorToken("google_workspace", {
      accessToken: "access-token",
      expiresAt: Date.now() + 120_000,
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
    });
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/messages?")) {
        return Response.json({ messages: [{ id: "message-1" }], resultSizeEstimate: 1 });
      }
      return Response.json({
        id: "message-1",
        snippet: "Project update",
        payload: {
          headers: [
            { name: "From", value: "sender@example.com" },
            { name: "Subject", value: "Status" },
          ],
        },
      });
    }) as typeof fetch;

    const result = (await gmailSearch({ query: "is:unread", limit: 5 })) as {
      untrustedExternalContent: boolean;
      messages: Array<{ subject: string }>;
    };

    expect(requests).toHaveLength(2);
    expect(result.untrustedExternalContent).toBe(true);
    expect(result.messages[0]?.subject).toBe("Status");
  });

  test("blocks connector writes unless read-write access was authorized", async () => {
    updateAccountConnectorConfig("google_workspace", { clientId: "google-client" });
    storeAccountConnectorToken("google_workspace", {
      accessToken: "access-token",
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
    });

    expect(
      gmailSend({ to: "recipient@example.com", subject: "Status", body: "Hello" })
    ).rejects.toThrow("Write access is disabled");
  });

  test("lists calendar events as untrusted account content", async () => {
    updateAccountConnectorConfig("google_workspace", { clientId: "google-client" });
    storeAccountConnectorToken("google_workspace", {
      accessToken: "access-token",
      expiresAt: Date.now() + 120_000,
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
    });
    globalThis.fetch = (async () =>
      Response.json({ items: [{ id: "event-1", summary: "Planning" }] })) as typeof fetch;

    const result = (await calendarList({ limit: 5 })) as {
      untrustedExternalContent: boolean;
      events: Array<{ id: string }>;
    };

    expect(result.untrustedExternalContent).toBe(true);
    expect(result.events[0]?.id).toBe("event-1");
  });

  test("validates calendar event ranges before creating events", async () => {
    expect(
      calendarCreate({
        summary: "Planning",
        start: "2026-07-13T12:00:00Z",
        end: "2026-07-13T11:00:00Z",
      })
    ).rejects.toThrow("end must be after start");
  });

  test("lists both providers and disconnects without deleting client configuration", () => {
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });

    expect(listAccountConnectorStatuses().map((item) => item.id)).toEqual([
      "google_workspace",
      "dropbox",
    ]);
    const status = disconnectAccountConnector("dropbox");
    expect(status.connected).toBe(false);
    expect(status.configured).toBe(true);
  });

  test("revokes remote authorization and always clears local tokens", async () => {
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      throw new Error("offline");
    }) as typeof fetch;

    const status = await revokeAccountConnector("dropbox");

    expect(requests).toEqual(["https://api.dropboxapi.com/2/auth/token/revoke"]);
    expect(status.connected).toBe(false);
    expect(getStoredAccountConnector("dropbox").refreshToken).toBeUndefined();
  });

  test("advertises only tools supported by connected account access", () => {
    const names = (): string[] => getToolSchemasForLLM().map((tool) => tool.name);
    expect(names()).not.toContain("account_connector");
    expect(names()).not.toContain("account_connector_write");

    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app", access: "read" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });
    expect(names()).toContain("account_connector");
    expect(names()).not.toContain("account_connector_write");

    updateAccountConnectorConfig("dropbox", { access: "read_write" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      scopes: [
        "account_info.read",
        "files.metadata.read",
        "files.content.read",
        "files.content.write",
      ],
    });
    expect(names()).toContain("account_connector");
    expect(names()).toContain("account_connector_write");
  });
});
