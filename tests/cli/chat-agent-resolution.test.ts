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
          message: {
            content: "done",
            tool_calls: [{ id: "tool-1", name: "write", status: "completed" }],
            process_activities: [{ id: "activity-1", phase: "tool_result", text: "wrote file" }],
          },
        } as T;
      }
      return null;
    },
    withAuthHeaders: (headers?: HeadersInit): Headers => new Headers(headers),
  });

  const originalLog = console.log;
  const output: string[] = [];
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    await rawAgent(["Inspect the project", "--json", "--agent", "Kimi"]);
  } finally {
    console.log = originalLog;
  }

  expect(requestBody.agentId).toBe("kimi-agent-id");
  expect(requestBody.message).toBe("Inspect the project");
  expect(requestBody.sessionId).toBeString();
  expect(JSON.parse(output.at(-1) || "{}")).toMatchObject({
    toolCalls: [{ id: "tool-1", name: "write", status: "completed" }],
    processActivities: [{ id: "activity-1", phase: "tool_result", text: "wrote file" }],
  });
});

test("one-shot chat recovers the gateway-owned result after its request disconnects", async () => {
  const sessionId = "session-long-turn";
  let statusChecks = 0;
  let messageFetches = 0;
  configureChatCli({
    apiBase: "http://127.0.0.1:4269",
    fetchAPI: async <T>(endpoint: string): Promise<T | null> => {
      if (endpoint === "/api/chat") return null;
      if (endpoint.includes("/api/status/sessions")) {
        statusChecks += 1;
        return { active: false } as T;
      }
      if (endpoint.endsWith("/messages")) {
        messageFetches += 1;
        if (messageFetches === 1) return [] as T;
        return [
          { role: "user", content: "Build it" },
          { role: "assistant", content: "Built and verified." },
        ] as T;
      }
      return null;
    },
    withAuthHeaders: (headers?: HeadersInit): Headers => new Headers(headers),
  });

  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    await rawAgent(["Build it", "--json", "--session", sessionId]);
  } finally {
    console.log = originalLog;
  }

  expect(statusChecks).toBe(1);
  expect(JSON.parse(output.at(-1) || "{}")).toEqual({
    sessionId,
    content: "Built and verified.",
  });
});

test("one-shot JSON chat reports interrupted provider failures with a failing exit code", async () => {
  configureChatCli({
    apiBase: "http://127.0.0.1:4269",
    fetchAPI: async <T>(endpoint: string): Promise<T | null> => {
      if (endpoint === "/api/chat") {
        return {
          sessionId: "session-rate-limited",
          interrupted: true,
          failure: { category: "rate_limit", retryable: true },
          message: {
            content: "Response interrupted before completion. Send the message again to retry.",
          },
        } as T;
      }
      return null;
    },
    withAuthHeaders: (headers?: HeadersInit): Headers => new Headers(headers),
  });

  const output: string[] = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    process.exitCode = 0;
    await rawAgent(["Run the task", "--json"]);

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.at(-1) || "{}")).toEqual({
      sessionId: "session-rate-limited",
      content: "Response interrupted before completion. Send the message again to retry.",
      interrupted: true,
      failure: { category: "rate_limit", retryable: true },
    });
  } finally {
    process.exitCode = originalExitCode ?? 0;
    console.log = originalLog;
  }
});
