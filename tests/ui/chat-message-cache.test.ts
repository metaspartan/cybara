import { describe, expect, test } from "bun:test";
import {
  clearCachedSessionMessages,
  enrichReloadedMessages,
  readCachedSessionMessages,
  writeCachedSessionMessages,
} from "../../ui/src/pages/chat/messageCache";
import type { ChatMessage } from "../../ui/src/types";

function message(
  role: ChatMessage["role"],
  content: string,
  timestamp: string,
  thinking?: string
): ChatMessage {
  return { role, content, timestamp, thinking };
}

describe("chat message cache", () => {
  test("keeps a locally newer turn when an active-session reload is behind", () => {
    const reference = [
      message("user", "first", "2026-07-13T01:00:00Z"),
      message("assistant", "done", "2026-07-13T01:00:01Z"),
      message("user", "continue", "2026-07-13T01:01:00Z"),
    ];
    const staleReload = [
      message("user", "first", "2026-07-13T01:00:00.100Z"),
      message("assistant", "done", "2026-07-13T01:00:01.100Z"),
    ];

    expect(enrichReloadedMessages(reference, staleReload, { preserveReferenceTail: true })).toEqual(
      [...staleReload, reference[2]]
    );
  });

  test("does not restore removed turns for an authoritative completed-session reload", () => {
    const reference = [
      message("user", "first", "2026-07-13T01:00:00Z"),
      message("assistant", "done", "2026-07-13T01:00:01Z"),
      message("user", "reverted", "2026-07-13T01:01:00Z"),
    ];
    const reloaded = reference.slice(0, 2);

    expect(enrichReloadedMessages(reference, reloaded)).toEqual(reloaded);
  });

  test("does not append a local tail when the histories diverge", () => {
    const reference = [
      message("user", "original", "2026-07-13T01:00:00Z"),
      message("assistant", "old reply", "2026-07-13T01:00:01Z"),
    ];
    const reloaded = [message("user", "edited", "2026-07-13T01:00:00Z")];

    expect(enrichReloadedMessages(reference, reloaded, { preserveReferenceTail: true })).toEqual(
      reloaded
    );
  });

  test("retains in-progress message detail when persisted content catches up", () => {
    const reference = [message("assistant", "working", "2026-07-13T01:00:00Z", "Inspecting files")];
    const reloaded = [message("assistant", "working", "2026-07-13T01:00:00Z")];

    expect(enrichReloadedMessages(reference, reloaded)[0]?.thinking).toBe("Inspecting files");
  });

  test("restores the latest transcript after navigation", () => {
    const sessionId = `active-navigation-${Date.now()}`;
    const messages = [message("user", "keep this visible", "2026-07-13T01:00:00Z")];
    writeCachedSessionMessages(sessionId, messages);

    expect(readCachedSessionMessages(sessionId)).toEqual(messages);

    clearCachedSessionMessages(sessionId);
    expect(readCachedSessionMessages(sessionId)).toBeNull();
  });
});
