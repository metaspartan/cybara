import { afterEach, describe, expect, test } from "bun:test";
import { createCliProviderCommands } from "../../src/cli/commands/provider-commands";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function commands() {
  return createCliProviderCommands(
    async () => null,
    "http://127.0.0.1:4269",
    (headers) => new Headers(headers)
  );
}

describe("CLI provider account pools", () => {
  test("parses named pool flags and bounded account priorities", () => {
    const parsed = commands().parsePoolFlags([
      "--name",
      "Work plans",
      "--provider",
      "openai-codex",
      "--account",
      "primary:25",
      "--account",
      "backup:25000",
      "--disabled",
    ]);
    expect(parsed).toEqual({
      name: "Work plans",
      provider: "openai-codex",
      enabled: false,
      accounts: [
        { provider_id: "primary", priority: 25 },
        { provider_id: "backup", priority: 10_000 },
      ],
    });
  });

  test("leaves account ordering automatic when priority is omitted", () => {
    expect(
      commands().parsePoolFlags([
        "--name",
        "Work plans",
        "--provider",
        "openai-codex",
        "--account",
        "primary",
        "--account",
        "backup",
      ]).accounts
    ).toEqual([{ provider_id: "primary" }, { provider_id: "backup" }]);
  });

  test("creates a named pool through the pool API", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "pool-1",
        name: "Work plans",
        provider: "openai-codex",
        enabled: true,
        accounts: [],
      });
    }) as typeof fetch;

    await commands().poolCreate({
      name: "Work plans",
      provider: "openai-codex",
      accounts: [{ provider_id: "primary", priority: 10 }],
    });

    expect(requestUrl).toBe("http://127.0.0.1:4269/api/provider-account-pools");
    expect(requestBody).toEqual({
      name: "Work plans",
      provider: "openai-codex",
      accounts: [{ provider_id: "primary", priority: 10 }],
    });
  });

  test("updates only explicitly supplied pool fields", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "pool-1",
        name: "Work plans",
        provider: "openai-codex",
        enabled: false,
        accounts: [{ provider_id: "primary", priority: null }],
      });
    }) as typeof fetch;

    const flags = commands().parsePoolFlags(["--disabled"]);
    await commands().poolUpdate("pool-1", flags);

    expect(requestUrl).toBe("http://127.0.0.1:4269/api/provider-account-pools/pool-1");
    expect(requestBody).toEqual({ enabled: false });
  });
});
