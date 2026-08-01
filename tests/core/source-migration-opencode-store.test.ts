import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { cybaraDir } from "../../src/core/paths";
import { createCybaraOpenCodeSessionStore } from "../../src/core/source-migration-opencode-store";
import db, { tables } from "../../src/core/database";

const sessionIds: string[] = [];

afterEach(() => {
  for (const sessionId of sessionIds.splice(0)) {
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    tables.chatSessions.delete(sessionId);
    const attachments = join(cybaraDir, "attachments", sessionId);
    if (existsSync(attachments)) rmSync(attachments, { recursive: true, force: true });
  }
});

describe("OpenCode session persistence", () => {
  test("writes canonical chat messages and attachment metadata", async () => {
    const sessionId = `migration-opencode-store-${randomUUID()}`;
    sessionIds.push(sessionId);
    const store = createCybaraOpenCodeSessionStore();

    expect(await store.exists(sessionId)).toBe(false);
    await store.write(sessionId, {
      sourceId: "ses-real-store",
      title: "Imported project review",
      workspaceDir: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      messages: [
        {
          role: "user",
          content: "Review this image.",
          timestamp: "2023-11-14T22:13:20.000Z",
          images: [{ data: "AQID", mimeType: "image/png" }],
        },
        {
          role: "assistant",
          content: "Review complete.",
          timestamp: "2023-11-14T22:13:21.000Z",
          thinking: "Inspect the evidence.",
          provider: "nvidia",
          model: "z-ai/glm-5.2",
          tool_calls: [
            {
              id: "call-read",
              name: "read",
              args: { path: "README.md" },
              result: "contents",
              status: "completed",
            },
          ],
        },
      ],
    });

    expect(await store.exists(sessionId)).toBe(true);
    expect(tables.chatSessions.get(sessionId)).toMatchObject({
      title: "Imported project review",
      created_at: "2023-11-14 22:13:20.000",
      updated_at: "2023-11-14 22:15:00.000",
    });
    const messages = tables.sessionMessages.getBySession(sessionId) as Array<{
      role: string;
      content: string;
      metadata?: string;
    }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Review this image." });
    expect(JSON.parse(messages[0]?.metadata || "{}")).toMatchObject({
      migration_source: "opencode",
      migration_source_session_id: "ses-real-store",
      attachments: [{ kind: "image", mimeType: "image/png" }],
    });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "Review complete." });
    expect(JSON.parse(messages[1]?.metadata || "{}")).toMatchObject({
      thinking: "Inspect the evidence.",
      provider: "nvidia",
      model: "z-ai/glm-5.2",
      tool_calls: [{ id: "call-read", name: "read", status: "completed" }],
    });
  });
});
