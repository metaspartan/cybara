import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";
import { MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT } from "../../apps/mobile/src/lib/chat-format";
import {
  clearCachedMobileSessionTranscript,
  readCachedMobileSessionTranscript,
  writeCachedMobileSessionTranscript,
} from "../../apps/mobile/src/screens/dashboardSessionTranscriptCache";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

function message(id: string): SessionMessageSummary {
  return { id, role: "assistant", content: `body ${id}` } as SessionMessageSummary;
}

describe("mobile session transcript cache", () => {
  test("returns a cached transcript so reopening a chat paints immediately", () => {
    const sessionId = `mobile-transcript-${Date.now()}`;
    expect(readCachedMobileSessionTranscript(sessionId)).toEqual([]);

    writeCachedMobileSessionTranscript(sessionId, [message("a"), message("b")]);
    expect(readCachedMobileSessionTranscript(sessionId).map((m) => m.id)).toEqual(["a", "b"]);

    clearCachedMobileSessionTranscript(sessionId);
    expect(readCachedMobileSessionTranscript(sessionId)).toEqual([]);
  });

  test("keeps only what the screen can render", () => {
    const sessionId = `mobile-transcript-bound-${Date.now()}`;
    const many = Array.from({ length: MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT + 25 }, (_, index) =>
      message(`m${index}`)
    );
    writeCachedMobileSessionTranscript(sessionId, many);

    const cached = readCachedMobileSessionTranscript(sessionId);
    expect(cached).toHaveLength(MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT);
    expect(cached[cached.length - 1]?.id).toBe(`m${many.length - 1}`);
    clearCachedMobileSessionTranscript(sessionId);
  });

  test("evicts the least recently written sessions", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `mobile-evict-${index}`);
    for (const id of ids) writeCachedMobileSessionTranscript(id, [message(id)]);

    expect(readCachedMobileSessionTranscript(ids[0])).toEqual([]);
    expect(readCachedMobileSessionTranscript(ids[ids.length - 1]).map((m) => m.id)).toEqual([
      ids[ids.length - 1],
    ]);
    for (const id of ids) clearCachedMobileSessionTranscript(id);
  });

  test("mobile stops asking the gateway for untruncated tool payloads", () => {
    const api = readFileSync(join(ROOT_DIR, "apps", "mobile", "src", "lib", "api.ts"), "utf8");
    expect(api).not.toContain("includeFullToolCalls");
  });

  test("the session runtime paints from the cache and refills it", () => {
    const runtime = readFileSync(
      join(ROOT_DIR, "apps", "mobile", "src", "screens", "useMobileSessionRuntime.ts"),
      "utf8"
    );
    expect(runtime).toContain("readCachedMobileSessionTranscript(sessionId)");
    expect(runtime).toContain("writeCachedMobileSessionTranscript(sessionId, nextDetail.messages)");
  });
});
