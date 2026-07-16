import { afterEach, describe, expect, test } from "bun:test";
import { runConnectorCommand } from "../../src/cli/commands/connectors";

const originalLog = console.log;
const originalSecret = process.env.CYBARA_CONNECTOR_CLIENT_SECRET;

afterEach(() => {
  console.log = originalLog;
  if (originalSecret === undefined) delete process.env.CYBARA_CONNECTOR_CLIENT_SECRET;
  else process.env.CYBARA_CONNECTOR_CLIENT_SECRET = originalSecret;
});

describe("connector CLI", () => {
  test("lists connector state without exposing credentials", async () => {
    const output: string[] = [];
    console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));
    const fetchAPI = async <T>(endpoint: string): Promise<T | null> => {
      expect(endpoint).toBe("/api/connectors");
      return [
        {
          id: "google_workspace",
          label: "Google Workspace",
          services: ["Gmail", "Drive", "Calendar"],
          docsUrl: "https://example.com",
          redirectUri: "http://127.0.0.1:4269/api/connectors/oauth/callback",
          configured: true,
          connected: true,
          access: "read",
          account: "person@example.com",
        },
      ] as T;
    };

    await runConnectorCommand(["list"], fetchAPI);

    expect(output.join("\n")).toContain("connected as person@example.com");
    expect(output.join("\n")).toContain("Gmail, Drive, Calendar");
  });

  test("configures write access using an environment-provided secret", async () => {
    console.log = () => {};
    process.env.CYBARA_CONNECTOR_CLIENT_SECRET = "private-secret";
    let request: { endpoint: string; body: Record<string, unknown> } | undefined;
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      request = {
        endpoint,
        body: JSON.parse(String(options?.body || "{}")) as Record<string, unknown>,
      };
      return {
        id: "google_workspace",
        label: "Google Workspace",
        services: [],
        docsUrl: "https://example.com",
        redirectUri: "http://127.0.0.1:4269/api/connectors/oauth/callback",
        configured: true,
        connected: false,
        access: "read_write",
      } as T;
    };

    await runConnectorCommand(
      ["configure", "google_workspace", "--client-id", "client-id", "--write"],
      fetchAPI
    );

    expect(request).toEqual({
      endpoint: "/api/connectors/google_workspace",
      body: {
        clientId: "client-id",
        clientSecret: "private-secret",
        access: "read_write",
      },
    });
  });

  test("accepts every canonical connector ID", async () => {
    console.log = () => {};
    const endpoints: string[] = [];
    const fetchAPI = async <T>(endpoint: string): Promise<T | null> => {
      endpoints.push(endpoint);
      return {
        id: endpoint.split("/").at(-1),
        label: "Connector",
        services: [],
        docsUrl: "https://example.com",
        redirectUri: "http://127.0.0.1:4269/api/connectors/oauth/callback",
        configured: true,
        connected: false,
        access: "read",
      } as T;
    };

    for (const id of ["google_workspace", "microsoft_365", "dropbox", "notion"]) {
      await runConnectorCommand(["configure", id, "--client-id", "client-id"], fetchAPI);
    }

    expect(endpoints).toEqual([
      "/api/connectors/google_workspace",
      "/api/connectors/microsoft_365",
      "/api/connectors/dropbox",
      "/api/connectors/notion",
    ]);
  });
});
