import { afterEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "../../src/core/agent";
import type { Provider } from "../../src/core/database";
import {
  callCursorAgentTransport,
  callCursorTransport,
  callDevinAgentTransport,
  callGitLabDuoTransport,
} from "../../src/core/llm/agent-provider-transports";
import { callCursorSdkTransport, cursorSdkPrompt } from "../../src/core/llm/cursor-sdk-transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(overrides: Partial<Provider>): Provider {
  return {
    id: crypto.randomUUID(),
    provider: "cursor",
    name: "Test provider",
    is_default: false,
    ...overrides,
  };
}

const messages: AgentMessage[] = [
  { role: "system", content: "Follow the project rules" },
  { role: "user", content: "Inspect the repository" },
];

describe("native account-provider transports", () => {
  test("runs Cursor CLI without exposing the credential in process arguments", async () => {
    let capturedCommand: string[] = [];
    let capturedEnvironment: Record<string, string | undefined> = {};
    const result = await callCursorAgentTransport(
      provider({ api_key: "cursor-secret" }),
      "cursor-model",
      messages,
      { agentId: "agent-1", workspaceDir: "/workspace" },
      {
        commandAvailable: () => true,
        run: async (command, options) => {
          capturedCommand = command;
          capturedEnvironment = options.env;
          return { stdout: "Completed repository inspection\n", stderr: "", exitCode: 0 };
        },
      }
    );

    expect(result.content).toBe("Completed repository inspection");
    expect(capturedCommand[0]).toBe("cursor-agent");
    expect(capturedCommand).toContain("--output-format");
    expect(capturedCommand.join(" ")).not.toContain("cursor-secret");
    expect(capturedEnvironment.CURSOR_API_KEY).toBe("cursor-secret");
  });

  test("fails Cursor transport before spawning when the CLI is unavailable", async () => {
    let spawned = false;
    await expect(
      callCursorAgentTransport(
        provider({ access_token: "token" }),
        "default",
        messages,
        undefined,
        {
          commandAvailable: () => false,
          run: async () => {
            spawned = true;
            return { stdout: "", stderr: "", exitCode: 0 };
          },
        }
      )
    ).rejects.toThrow("cursor-agent is not available in PATH");
    expect(spawned).toBe(false);
  });

  test("uses GitLab Duo chat completions with bearer authentication", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let authorization = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") || "";
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json("Duo response");
    }) as typeof fetch;

    const result = await callGitLabDuoTransport(
      provider({ provider: "gitlab-duo", base_url: "https://gitlab.example/", access_token: "gl" }),
      messages
    );

    expect(result.content).toBe("Duo response");
    expect(requestUrl).toBe("https://gitlab.example/api/v4/chat/completions");
    expect(authorization).toBe("Bearer gl");
    expect(requestBody.with_clean_history).toBe(true);
    expect(String(requestBody.content)).toContain("Inspect the repository");
  });

  test("creates, polls, and reads a completed Devin session", async () => {
    const requested: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(`${init?.method || "GET"} ${url}`);
      if (init?.method === "POST") return Response.json({ session_id: "devin-session" });
      if (url.endsWith("/messages")) {
        return Response.json({
          messages: [
            { source: "user", message: "request" },
            { source: "devin", message: "Completed the task" },
          ],
        });
      }
      return Response.json({ status_enum: "finished" });
    }) as typeof fetch;

    const result = await callDevinAgentTransport(
      provider({
        provider: "devin",
        base_url: "https://api.devin.ai/",
        api_key: "cog_secret",
        settings: { organizationId: "org_123", pollIntervalMs: 500, timeoutMs: 10_000 },
      }),
      messages,
      undefined,
      { fetch: fakeFetch, wait: async () => {} }
    );

    expect(result.content).toBe("Completed the task");
    expect(requested).toEqual([
      "POST https://api.devin.ai/v3/organizations/org_123/sessions",
      "GET https://api.devin.ai/v3/organizations/org_123/sessions/devin-session",
      "GET https://api.devin.ai/v3/organizations/org_123/sessions/devin-session/messages",
    ]);
  });

  test("rejects Devin configuration without an organization ID", async () => {
    await expect(
      callDevinAgentTransport(
        provider({ provider: "devin", api_key: "cog_secret" }),
        messages,
        undefined,
        { fetch: originalFetch, wait: async () => {} }
      )
    ).rejects.toThrow("organization ID");
  });

  test("maps Cursor SDK prompt roles, tool output, and image attachments", () => {
    const prompt = cursorSdkPrompt([
      { role: "system", content: "Follow the project rules" },
      { role: "tool", content: "Ran tests: 10 passed" },
      {
        role: "user",
        content: "What is in this screenshot?",
        images: [{ data: "aGVsbG8=", mimeType: "image/jpeg" }],
      },
      { role: "assistant", content: "A chart" },
    ]);

    expect(prompt).toEqual([
      { role: "system", content: "Follow the project rules" },
      { role: "user", content: [{ type: "text", text: "TOOL\nRan tests: 10 passed" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this screenshot?" },
          { type: "file", data: "aGVsbG8=", mediaType: "image/jpeg" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "A chart" }] },
    ]);
  });

  test("runs Cursor through the SDK transport without spawning the CLI", async () => {
    let spawned = false;
    let capturedPrompt: unknown[] = [];
    let capturedModel = "";
    let capturedCredential: Record<string, string | undefined> = {};
    const sdk = ((options: Record<string, unknown>) => {
      capturedCredential = {
        accessToken: options.accessToken as string | undefined,
        apiKey: options.apiKey as string | undefined,
      };
      return {
        languageModel: (modelId: string) => {
          capturedModel = modelId;
          return {
            doGenerate: async (callOptions: { prompt: unknown[] }) => {
              capturedPrompt = callOptions.prompt;
              return {
                content: [
                  { type: "text", text: "SDK repository inspection" },
                  { type: "reasoning", text: "thinking" },
                ],
                finishReason: "stop",
              };
            },
          };
        },
      };
    }) as unknown as Parameters<typeof callCursorSdkTransport>[3]["sdk"];

    const result = await callCursorSdkTransport(
      provider({ access_token: "cursor-oauth-token" }),
      "grok-4.7",
      messages,
      { sdk }
    );

    expect(result.content).toBe("SDK repository inspection");
    expect(capturedCredential.accessToken).toBe("cursor-oauth-token");
    expect(capturedCredential.apiKey).toBeUndefined();
    expect(capturedModel).toBe("grok-4.7");
    expect(capturedPrompt).toEqual([
      { role: "system", content: "Follow the project rules" },
      { role: "user", content: [{ type: "text", text: "Inspect the repository" }] },
    ]);
    expect(spawned).toBe(false);
  });

  test("uses an API key credential through the SDK when no access token exists", async () => {
    let capturedCredential: Record<string, string | undefined> = {};
    const sdk = ((options: Record<string, unknown>) => {
      capturedCredential = {
        accessToken: options.accessToken as string | undefined,
        apiKey: options.apiKey as string | undefined,
      };
      return {
        languageModel: () => ({
          doGenerate: async () => ({
            content: [{ type: "text", text: "ok" }],
            finishReason: "stop",
          }),
        }),
      };
    }) as unknown as Parameters<typeof callCursorSdkTransport>[3]["sdk"];

    const result = await callCursorSdkTransport(
      provider({ api_key: "crsr_key" }),
      "default",
      messages,
      { sdk }
    );
    expect(result.content).toBe("ok");
    expect(capturedCredential.apiKey).toBe("crsr_key");
    expect(capturedCredential.accessToken).toBeUndefined();
  });

  test("raises Cursor SDK errors instead of silently falling back to the CLI", async () => {
    let spawned = false;
    await expect(
      callCursorTransport(
        provider({ access_token: "cursor-oauth-token" }),
        "grok-4.7",
        messages,
        undefined,
        {
          commandAvailable: () => true,
          run: async () => {
            spawned = true;
            return { stdout: "", stderr: "", exitCode: 0 };
          },
          loadSdk: async () => ({
            createCursor: () => {
              throw new Error("Cursor session expired");
            },
          }),
        }
      )
    ).rejects.toThrow("Cursor session expired");
    expect(spawned).toBe(false);
  });

  test("prefers the SDK transport even when the CLI is installed", async () => {
    let spawned = false;
    const result = await callCursorTransport(
      provider({ access_token: "cursor-oauth-token" }),
      "grok-4.7",
      messages,
      undefined,
      {
        commandAvailable: () => true,
        run: async () => {
          spawned = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        loadSdk: async () =>
          ({
            createCursor: () => ({
              languageModel: () => ({
                doGenerate: async () => ({
                  content: [{ type: "text", text: "SDK preferred" }],
                  finishReason: "stop",
                }),
              }),
            }),
          }) as unknown as Awaited<
            ReturnType<NonNullable<Parameters<typeof callCursorTransport>[4]["loadSdk"]>>
          >,
      }
    );

    expect(result.content).toBe("SDK preferred");
    expect(spawned).toBe(false);
  });
});
