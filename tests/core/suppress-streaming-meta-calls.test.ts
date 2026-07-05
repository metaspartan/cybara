import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// Meta LLM calls (session-title generation, memory flush, inline completion)
// must not stream their tokens/status into the visible chat as if they were
// the assistant's reply — the reported "title text shows during Thinking" bug.
describe("meta LLM calls suppress live streaming", () => {
  test("ToolContext exposes suppressStreaming", () => {
    expect(read("src/core/tools/index.ts")).toContain("suppressStreaming?: boolean;");
  });

  test("status + Codex token broadcasts are gated by suppressStreaming", () => {
    const agent = read("src/core/agent.ts");
    // Status broadcasts short-circuit for suppressed calls.
    expect(agent).toContain("if (toolContext?.suppressStreaming) return;");
    // The Codex token-delta stream passes no sessionId when suppressed, so
    // broadcastTokenDelta (guarded by `if (sessionId)`) never fires.
    expect(agent).toContain(
      "toolContext?.suppressStreaming ? undefined : toolContext?.sessionId"
    );
  });

  test("title generation, memory flush, and inline completion set the flag", () => {
    const chat = read("src/api/chat.ts");
    // Title generation call.
    expect(chat).toMatch(/Generate the best session title[\s\S]*?suppressStreaming: true/);
    // Memory flush call.
    expect(chat).toContain("Memory flush is a background meta call");
    const routes = read("src/api/routes.ts");
    expect(routes).toContain("Inline completion is a meta call");
  });
});
