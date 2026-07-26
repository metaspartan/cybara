import { afterEach, describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import { persistSession } from "../../src/core/session-context";
import type { ChatMessage } from "../../src/api/chat";

const createdSessionIds: string[] = [];

function makeSessionId(label: string): string {
  return `persist-result-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const messages: ChatMessage[] = [
  { role: "user", content: "hi", timestamp: "2099-01-01T00:00:00.000Z" },
  { role: "assistant", content: "hello", timestamp: "2099-01-01T00:00:01.000Z" },
];

afterEach(() => {
  for (const id of createdSessionIds.splice(0)) {
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  }
});

describe("persistSession result signalling", () => {
  test("returns true when the write succeeds", async () => {
    const id = makeSessionId("ok");
    createdSessionIds.push(id);
    const ok = await persistSession(id, "test-agent", messages, null, "Title");
    expect(ok).toBe(true);
    const row = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  test("returns false when persistence fails (invalid workspace dir), not a false success", async () => {
    const id = makeSessionId("fail");
    const ok = await persistSession(
      id,
      "test-agent",
      messages,
      "/definitely/not/a/real/path/cybara-test-xyz",
      "Title"
    );
    expect(ok).toBe(false);
    const row = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(id);
    expect(row).toBeFalsy();
  });
});
