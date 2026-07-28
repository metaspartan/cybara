import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function source(path: string): string {
  return readFileSync(join(ROOT_DIR, path), "utf8");
}

describe("CLI chat source wiring", () => {
  test("interactive chat owns queueing, steering, and session controls outside the main CLI file", () => {
    const cliSource = source("src/cli/index.tsx");
    const chatSource = source("src/cli/commands/chat.ts");

    expect(cliSource).toContain(
      'import { configureChatCli, rawAgent, rawChatCommand } from "./commands/chat";'
    );
    expect(cliSource).toContain("configureChatCli({");
    expect(cliSource).not.toContain('import { createInterface } from "readline";');
    expect(cliSource).not.toContain("async function rawChat(");

    for (const command of [
      "/pending",
      "/queue <message>",
      "/steer <id|#n>",
      "/edit <id|#n> <message>",
      "/delete <id|#n>",
      "/reorder <id|#n>...",
      "/agent <id|name|default>",
      "/workspace <path>",
    ]) {
      expect(chatSource).toContain(command);
    }

    expect(chatSource).toContain('queueMode: "queue"');
    expect(chatSource).toContain("/pending/reorder");
    expect(chatSource).toContain("Working. Type a follow-up to queue it");
    expect(chatSource).toContain("sessionId ||= crypto.randomUUID();");
    expect(chatSource).toContain("{ message, sessionId, tools: true }");
    expect(chatSource).toContain("formatMarkdownForTerminal");
    expect(chatSource).toContain("agentId = await resolveAgentId(agentId)");
    expect(chatSource).toContain('fetchAPI<CliChatSessionSummary[]>("/api/sessions?limit=10")');
    expect(chatSource).toContain("`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`");
    expect(chatSource).not.toContain("`/api/sessions/${encodeURIComponent(sessionId)}/messages`");
  });
});
