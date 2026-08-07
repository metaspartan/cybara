import { readFileSync, statSync } from "fs";
import { agentManager } from "./agent";
import { persistImageAttachments } from "./chat/attachments";
import db, { tables } from "./database";
import { persistSession, upsertPersistedSessionMessage } from "./session-context";
import type { OpenCodeSessionSnapshot, OpenCodeSessionStore } from "./source-migration-opencode";
import type { AgentImage } from "./llm/image-blocks";

function materializeImages(images?: AgentImage[]): AgentImage[] {
  if (!images) return [];
  return images.flatMap((image) => {
    if (!image.path) return [image];
    try {
      const stat = statSync(image.path);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 8 * 1024 * 1024) return [];
      return [{ data: readFileSync(image.path).toString("base64"), mimeType: image.mimeType }];
    } catch {
      return [];
    }
  });
}

function sqliteTimestamp(value: number): string {
  return new Date(Math.max(0, value)).toISOString().replace("T", " ").replace("Z", "");
}

export function createCybaraOpenCodeSessionStore(
  migrationSource = "opencode"
): OpenCodeSessionStore {
  return {
    async exists(sessionId: string): Promise<boolean> {
      return Boolean(tables.chatSessions.get(sessionId));
    },
    async write(sessionId: string, snapshot: OpenCodeSessionSnapshot): Promise<void> {
      const agentId = agentManager.list()[0]?.id || "default";
      if (tables.chatSessions.get(sessionId)) tables.chatSessions.delete(sessionId);
      const persisted = await persistSession(
        sessionId,
        agentId,
        snapshot.messages,
        snapshot.workspaceDir,
        snapshot.title
      );
      if (!persisted) throw new Error("Unable to create imported chat session");
      for (let index = 0; index < snapshot.messages.length; index += 1) {
        const message = snapshot.messages[index];
        const persistedAttachments = persistImageAttachments(
          sessionId,
          materializeImages(message.images)
        );
        await upsertPersistedSessionMessage(sessionId, agentId, message, {
          stableKey: `${snapshot.sourceId}:${index}`,
          metadata: {
            migration_source: migrationSource,
            migration_source_session_id: snapshot.sourceId,
            ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
          },
        });
      }
      db.prepare("UPDATE chat_sessions SET created_at = ?, updated_at = ? WHERE id = ?").run(
        sqliteTimestamp(snapshot.createdAt),
        sqliteTimestamp(snapshot.updatedAt),
        sessionId
      );
    },
  };
}
