import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildCliAuthHeaders, resolveCliApiKey } from "../../src/cli/client";
import {
  type AgentItem,
  sessionAgentLabel,
  sessionMessageCount,
  sessionUpdatedAt,
} from "../../src/cli/contracts";

const tempDirectories: string[] = [];

function createTempHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "cybara-cli-client-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
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

  test("merges authentication without replacing caller headers", () => {
    const headers = buildCliAuthHeaders("secret", { "X-Request-ID": "request-1" }, true);

    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Request-ID")).toBe("request-1");

    const preserved = buildCliAuthHeaders(
      "secret",
      { Authorization: "Bearer override", "Content-Type": "text/plain" },
      true
    );
    expect(preserved.get("Authorization")).toBe("Bearer override");
    expect(preserved.get("Content-Type")).toBe("text/plain");
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
