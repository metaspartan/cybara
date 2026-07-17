import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCliAuthHeaders,
  CliApiError,
  formatCliApiError,
  requestCliAPI,
  resolveCliApiKey,
  resolveCliGatewayPassword,
  withCliAuthHeaders,
} from "../../src/cli/client";
import {
  type AgentItem,
  sessionAgentLabel,
  sessionMessageCount,
  sessionUpdatedAt,
} from "../../src/cli/contracts";

const tempDirectories: string[] = [];
const originalCybaraHome = process.env.CYBARA_HOME;
const originalCybaraApiKey = process.env.CYBARA_API_KEY;

function createTempHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "cybara-cli-client-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
  else process.env.CYBARA_HOME = originalCybaraHome;
  if (originalCybaraApiKey === undefined) delete process.env.CYBARA_API_KEY;
  else process.env.CYBARA_API_KEY = originalCybaraApiKey;
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI client contracts", () => {
  test("resolves explicit credentials before the local credential file", () => {
    const home = createTempHome();
    writeFileSync(join(home, "api_key"), "file-key\n");

    expect(resolveCliApiKey({ CYBARA_API_KEY: " env-key " }, home)).toBe("env-key");
    expect(resolveCliApiKey({}, home)).toBe("file-key");
  });

  test("returns null when no local credential exists", () => {
    expect(resolveCliApiKey({}, createTempHome())).toBeNull();
  });

  test("normalizes the optional remote gateway password", () => {
    expect(resolveCliGatewayPassword({ CYBARA_GATEWAY_PASSWORD: " remote-secret " })).toBe(
      "remote-secret"
    );
    expect(resolveCliGatewayPassword({ CYBARA_GATEWAY_PASSWORD: "  " })).toBeNull();
  });

  test("merges authentication without replacing caller headers", () => {
    const headers = buildCliAuthHeaders(
      "secret",
      { "X-Request-ID": "request-1" },
      true,
      "gateway-secret"
    );

    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Request-ID")).toBe("request-1");
    expect(headers.get("X-Cybara-Gateway-Password")).toBe("gateway-secret");

    const preserved = buildCliAuthHeaders(
      "secret",
      { Authorization: "Bearer override", "Content-Type": "text/plain" },
      true,
      "gateway-secret"
    );
    expect(preserved.get("Authorization")).toBe("Bearer override");
    expect(preserved.get("Content-Type")).toBe("text/plain");

    const preservedPassword = buildCliAuthHeaders(
      "secret",
      { "X-Cybara-Gateway-Password": "override" },
      false,
      "gateway-secret"
    );
    expect(preservedPassword.get("X-Cybara-Gateway-Password")).toBe("override");
  });

  test("reloads the local API key for long-lived CLI and TUI requests", () => {
    const home = createTempHome();
    process.env.CYBARA_HOME = home;
    delete process.env.CYBARA_API_KEY;
    writeFileSync(join(home, "api_key"), "first-key\n");
    expect(withCliAuthHeaders().get("Authorization")).toBe("Bearer first-key");
    writeFileSync(join(home, "api_key"), "rotated-key\n");
    expect(withCliAuthHeaders().get("Authorization")).toBe("Bearer rotated-key");
  });

  test("preserves endpoint and status details for TUI error rendering", async () => {
    const request = requestCliAPI("/api/providers", undefined, {
      apiBase: "http://127.0.0.1:4269",
      apiKey: "stale-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "Invalid API key" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const error = await request.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CliApiError);
    expect((error as CliApiError).endpoint).toBe("/api/providers");
    expect((error as CliApiError).status).toBe(401);
    expect(formatCliApiError(error)).toContain("Unauthorized (401)");
    expect(formatCliApiError(error)).toContain("/api/providers");
  });

  test("rejects malformed successful gateway responses", async () => {
    await expect(
      requestCliAPI("/api/providers", undefined, {
        fetchImpl: async () => new Response("not-json", { status: 200 }),
      })
    ).rejects.toThrow("Gateway returned invalid JSON");
  });
});

describe("CLI session contracts", () => {
  test("normalizes legacy and current session fields", () => {
    expect(sessionMessageCount({ id: "one", message_count: 4, messageCount: 9 })).toBe(4);
    expect(sessionMessageCount({ id: "two", messageCount: 9 })).toBe(9);
    expect(sessionUpdatedAt({ id: "three", updatedAt: "2026-07-15T12:00:00Z" })).toBe(
      "2026-07-15T12:00:00Z"
    );
  });

  test("prefers persisted model metadata and falls back to the configured agent", () => {
    const agents = new Map<string, AgentItem>([
      [
        "agent-1",
        {
          id: "agent-1",
          name: "Builder",
          model: "model-1",
          type: "local",
          status: "ready",
        },
      ],
    ]);

    expect(
      sessionAgentLabel(
        {
          id: "one",
          agent_id: "agent-1",
          modelMetadata: { agent_name: "Recorded", model: "model-2" },
        },
        agents
      )
    ).toBe("Recorded · model-2");
    expect(sessionAgentLabel({ id: "two", agentId: "agent-1" }, agents)).toBe("Builder · model-1");
    expect(sessionAgentLabel({ id: "three" }, agents)).toBe("-");
  });
});
