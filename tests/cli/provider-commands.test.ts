import { afterEach, describe, expect, test } from "bun:test";
import { createCliProviderCommands } from "../../src/cli/commands/provider-commands";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider commands", () => {
  test("parses custom provider URL flags", () => {
    const commands = createCliProviderCommands(
      async () => null,
      "http://localhost",
      () => new Headers()
    );
    expect(
      commands.parseFlags([
        "--name",
        "Private Gateway",
        "--key",
        "secret",
        "--base-url",
        "http://127.0.0.1:8765/api",
      ])
    ).toEqual({
      name: "Private Gateway",
      key: "secret",
      token: undefined,
      baseUrl: "http://127.0.0.1:8765/api",
      isDefault: false,
      oauth: false,
    });
  });

  test("sends a custom provider base URL when adding an account", async () => {
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Response.json({ id: "custom-provider-id" });
    }) as typeof fetch;
    const commands = createCliProviderCommands(
      async () => null,
      "http://localhost",
      () => new Headers({ "Content-Type": "application/json" })
    );

    await commands.add(
      "custom",
      "Private Gateway",
      "custom-secret",
      undefined,
      false,
      false,
      "http://127.0.0.1:8765/api"
    );

    expect(requestBody).toEqual({
      provider: "custom",
      name: "Private Gateway",
      api_key: "custom-secret",
      base_url: "http://127.0.0.1:8765/api",
    });
  });
});
