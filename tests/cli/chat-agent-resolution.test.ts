import { expect, test } from "bun:test";
import { configureChatCli, rawAgent } from "../../src/cli/commands/chat";

test("one-shot chat resolves an agent display name before sending the turn", async () => {
  let requestBody: Record<string, unknown> = {};
  configureChatCli({
    apiBase: "http://127.0.0.1:4269",
    fetchAPI: async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      if (endpoint === "/api/agents/summary") {
        return [
          {
            id: "kimi-agent-id",
            name: "Kimi",
            model: "k3",
          },
        ] as T;
      }
      if (endpoint === "/api/chat") {
        requestBody = options?.body
          ? (JSON.parse(String(options.body)) as Record<string, unknown>)
          : {};
        return {
          sessionId: "session-id",
          message: { content: "done" },
        } as T;
      }
      return null;
    },
    withAuthHeaders: (headers?: HeadersInit): Headers => new Headers(headers),
  });

  const originalLog = console.log;
  console.log = () => undefined;
  try {
    await rawAgent(["Inspect the project", "--json", "--agent", "Kimi"]);
  } finally {
    console.log = originalLog;
  }

  expect(requestBody.agentId).toBe("kimi-agent-id");
  expect(requestBody.message).toBe("Inspect the project");
});
