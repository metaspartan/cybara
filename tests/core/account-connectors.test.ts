import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  disconnectAccountConnector,
  getAccountConnectorStatus,
  getRequiredConnectorScopes,
  getStoredAccountConnector,
  listAccountConnectorStatuses,
  storeAccountConnectorToken,
  updateAccountConnectorConfig,
} from "../../src/core/account-connectors/store";
import {
  finishAccountConnectorOAuth,
  getAccountConnectorOAuthStatus,
  revokeAccountConnector,
  startAccountConnectorOAuth,
} from "../../src/core/account-connectors/oauth";
import {
  calendarCreate,
  calendarList,
  gmailSearch,
  gmailSend,
} from "../../src/core/account-connectors/client";
import {
  microsoftCalendarCreate,
  oneDriveSearch,
  outlookSend,
  outlookSearch,
} from "../../src/core/account-connectors/microsoft";
import {
  notionCreatePage,
  notionRead,
  notionSearch,
} from "../../src/core/account-connectors/notion";
import { getAccountConnectorAccessToken } from "../../src/core/account-connectors/tokens";
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

  test("creates Microsoft PKCE authorization with least-privilege delegated scopes", () => {
    updateAccountConnectorConfig("microsoft_365", {
      clientId: "microsoft-client",
      access: "read",
    });

    const started = startAccountConnectorOAuth("microsoft_365");
    const url = new URL(started.authUrl);

    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    expect(url.searchParams.get("scope")).not.toContain("Mail.Send");
    expect(getRequiredConnectorScopes("microsoft_365", "read_write")).toContain("Mail.Send");
  });

  test("requires complete Notion credentials and creates a state-bound authorization URL", () => {
    updateAccountConnectorConfig("notion", { clientId: "notion-client" });
    expect(() => startAccountConnectorOAuth("notion")).toThrow(
      "Configure the Notion client secret first"
    );

    updateAccountConnectorConfig("notion", { clientSecret: "notion-secret" });
    const started = startAccountConnectorOAuth("notion");
    const url = new URL(started.authUrl);

    expect(url.origin).toBe("https://api.notion.com");
    expect(url.pathname).toBe("/v1/oauth/authorize");
    expect(url.searchParams.get("state")).toBe(started.state);
    expect(url.searchParams.get("owner")).toBe("user");
    expect(started.authUrl).not.toContain("notion-secret");
  });

  test("finishes Microsoft OAuth and persists the refreshed identity", async () => {
    updateAccountConnectorConfig("microsoft_365", {
      clientId: "microsoft-client",
      access: "read",
    });
    const started = startAccountConnectorOAuth("microsoft_365");
    const requests: Array<{ url: string; body?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: typeof init?.body === "string" ? init.body : init?.body?.toString(),
      });
      if (url.includes("/oauth2/v2.0/token")) {
        return Response.json({
          access_token: "microsoft-access",
          refresh_token: "microsoft-refresh",
          expires_in: 3600,
          scope: getRequiredConnectorScopes("microsoft_365", "read").join(" "),
        });
      }
      return Response.json({ mail: "person@example.com", displayName: "Person" });
    }) as typeof fetch;

    await finishAccountConnectorOAuth(started.state, "authorization-code");

    expect(getAccountConnectorOAuthStatus(started.state).status).toBe("connected");
    expect(getAccountConnectorStatus("microsoft_365")).toMatchObject({
      connected: true,
      account: "person@example.com",
      needsReauthorization: false,
    });
    expect(requests[0]?.body).toContain("code_verifier=");
    expect(getStoredAccountConnector("microsoft_365").refreshToken).toBe("microsoft-refresh");
  });

  test("finishes Notion OAuth and refreshes an expired token", async () => {
    updateAccountConnectorConfig("notion", {
      clientId: "notion-client",
      clientSecret: "notion-secret",
    });
    const started = startAccountConnectorOAuth("notion");
    let tokenRequests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        tokenRequests += 1;
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return Response.json({
          access_token: tokenRequests === 1 ? "notion-access" : "notion-refreshed",
          refresh_token: "notion-refresh",
          expires_in: 60,
          scope: "",
          grant_type: body.grant_type,
        });
      }
      return Response.json({ name: "Research workspace" });
    }) as typeof fetch;

    await finishAccountConnectorOAuth(started.state, "authorization-code");
    expect(getAccountConnectorStatus("notion")).toMatchObject({
      connected: true,
      account: "Research workspace",
    });
    updateAccountConnectorConfig("notion", { access: "read" });
    storeAccountConnectorToken(
      "notion",
      {
        accessToken: "expired",
        refreshToken: "notion-refresh",
        expiresAt: Date.now() - 1,
        scopes: [],
      },
      "Research workspace"
    );

    expect(await getAccountConnectorAccessToken("notion")).toBe("notion-refreshed");
    expect(getStoredAccountConnector("notion").accessToken).toBe("notion-refreshed");
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

  test("searches Microsoft mail and OneDrive through bounded Graph requests", async () => {
    updateAccountConnectorConfig("microsoft_365", { clientId: "microsoft-client" });
    storeAccountConnectorToken("microsoft_365", {
      accessToken: "microsoft-token",
      expiresAt: Date.now() + 120_000,
      scopes: getRequiredConnectorScopes("microsoft_365", "read"),
    });
    const requests: string[] = [];
    const signals: Array<AbortSignal | null | undefined> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input));
      signals.push(init?.signal);
      return Response.json({ value: [{ id: "result-1", subject: "Planning" }] });
    }) as typeof fetch;

    const mail = (await outlookSearch({ query: "planning", limit: 5 })) as {
      messages: Array<{ id: string }>;
    };
    const files = (await oneDriveSearch({ query: "roadmap", limit: 5 })) as {
      files: Array<{ id: string }>;
    };

    expect(mail.messages[0]?.id).toBe("result-1");
    expect(files.files[0]?.id).toBe("result-1");
    expect(requests[0]).toContain("graph.microsoft.com/v1.0/me/messages");
    expect(requests[1]).toContain("graph.microsoft.com/v1.0/me/drive/root/search");
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  test("reads Notion markdown and marks connected content as untrusted", async () => {
    updateAccountConnectorConfig("notion", {
      clientId: "notion-client",
      clientSecret: "notion-secret",
    });
    storeAccountConnectorToken("notion", { accessToken: "notion-token", scopes: [] });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/markdown")) {
        return Response.json({ markdown: "# Project\n\nStatus", truncated: false });
      }
      if (url.includes("/pages/")) return Response.json({ object: "page", id: "page-1" });
      return Response.json({ results: [{ object: "page", id: "page-1" }], has_more: false });
    }) as typeof fetch;

    const search = (await notionSearch({ query: "Project" })) as {
      untrustedExternalContent: boolean;
      results: unknown[];
    };
    const read = (await notionRead({ pageId: "page-1" })) as {
      untrustedExternalContent: boolean;
      markdown: string;
    };

    expect(search.untrustedExternalContent).toBe(true);
    expect(search.results).toHaveLength(1);
    expect(read.untrustedExternalContent).toBe(true);
    expect(read.markdown).toContain("Project");
  });

  test("keeps Microsoft and Notion writes gated by connector access", async () => {
    updateAccountConnectorConfig("microsoft_365", { clientId: "microsoft-client" });
    storeAccountConnectorToken("microsoft_365", {
      accessToken: "microsoft-token",
      scopes: getRequiredConnectorScopes("microsoft_365", "read"),
    });
    updateAccountConnectorConfig("notion", {
      clientId: "notion-client",
      clientSecret: "notion-secret",
    });
    storeAccountConnectorToken("notion", { accessToken: "notion-token", scopes: [] });

    expect(
      microsoftCalendarCreate({
        summary: "Planning",
        start: "2026-07-13T12:00:00Z",
        end: "2026-07-13T13:00:00Z",
      })
    ).rejects.toThrow("Write access is disabled");
    expect(notionCreatePage({ parentPageId: "page-1", title: "Planning" })).rejects.toThrow(
      "Write access is disabled"
    );
  });

  test("creates Notion child pages with a current markdown payload", async () => {
    updateAccountConnectorConfig("notion", {
      clientId: "notion-client",
      clientSecret: "notion-secret",
      access: "read_write",
    });
    storeAccountConnectorToken("notion", { accessToken: "notion-token", scopes: [] });
    let payload: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({ object: "page", id: "page-2" });
    }) as typeof fetch;

    await notionCreatePage({
      parentPageId: "page-1",
      title: "Planning",
      content: "# Plan\n\nShip the connector.",
    });

    expect(payload.parent).toEqual({ type: "page_id", page_id: "page-1" });
    expect(payload.properties).toEqual({
      title: { title: [{ type: "text", text: { content: "Planning" } }] },
    });
    expect(payload.markdown).toBe("# Plan\n\nShip the connector.");
    expect(payload.children).toBeUndefined();
  });

  test("normalizes Microsoft recipient lists and calendar date-time payloads", async () => {
    updateAccountConnectorConfig("microsoft_365", {
      clientId: "microsoft-client",
      access: "read_write",
    });
    storeAccountConnectorToken("microsoft_365", {
      accessToken: "microsoft-token",
      expiresAt: Date.now() + 120_000,
      scopes: getRequiredConnectorScopes("microsoft_365", "read_write"),
    });
    const payloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      return Response.json({ id: "created" });
    }) as typeof fetch;

    await outlookSend({
      to: "one@example.com, two@example.com",
      cc: "copy@example.com",
      subject: "Planning",
      body: "Status",
    });
    await microsoftCalendarCreate({
      summary: "Planning",
      start: "2026-07-13T12:00:00Z",
      end: "2026-07-13T13:00:00Z",
    });

    const message = payloads[0]?.message as Record<string, unknown>;
    expect(message.toRecipients).toHaveLength(2);
    expect(message.ccRecipients).toHaveLength(1);
    const start = payloads[1]?.start as Record<string, unknown>;
    expect(start.dateTime).toBe("2026-07-13T12:00:00.000");
    expect(start.timeZone).toBe("UTC");
  });

  test("lists all connectors and disconnects without deleting client configuration", () => {
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });

    expect(listAccountConnectorStatuses().map((item) => item.id)).toEqual([
      "google_workspace",
      "microsoft_365",
      "dropbox",
      "notion",
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
