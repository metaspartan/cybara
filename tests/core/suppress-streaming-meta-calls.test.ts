import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readChatRuntimeSource, readProviderRuntimeSource } from "../source-fixtures";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("meta LLM calls suppress live streaming", () => {
  test("ToolContext exposes suppressStreaming", () => {
    expect(read("src/core/tools/types.ts")).toContain("suppressStreaming?: boolean;");
  });

  test("status + Codex token broadcasts are gated by suppressStreaming", () => {
    const runtime = readProviderRuntimeSource();
    expect(runtime).toContain("if (toolContext?.suppressStreaming) return;");
    expect(runtime).toContain(
      "toolContext?.suppressStreaming ? undefined : toolContext?.sessionId"
    );
  });

  test("title generation, memory flush, and inline completion set the flag", () => {
    const chat = readChatRuntimeSource();
    expect(chat).toMatch(/Generate the best session title[\s\S]*?suppressStreaming: true/);
    expect(chat).toMatch(/buildMemoryFlushMessages[\s\S]*?suppressStreaming: true/);
    const routes = read("src/api/routes/ide-lsp-routes.ts");
    expect(routes).toMatch(
      /You are an IDE inline code completion engine[\s\S]*?suppressStreaming: true/
    );
  });
});
