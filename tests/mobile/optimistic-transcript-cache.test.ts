import { describe, expect, test } from "bun:test";
import {
  clearCachedMobileOptimisticTranscript,
  mergeCachedMobileOptimisticTranscript,
  readCachedMobileOptimisticTranscript,
  writeCachedMobileOptimisticTranscriptMessage,
} from "../../apps/mobile/src/screens/dashboardOptimisticTranscript";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";

function userMessage(id: string, content: string, timestamp: string): SessionMessageSummary {
  return { id, role: "user", content, timestamp };
}

describe("mobile optimistic transcript cache", () => {
  test("restores a sent user message after the chat screen remounts", () => {
    const sessionId = `mobile-transcript-${Date.now()}`;
    const optimistic = userMessage("local-1", "review this workspace", "2026-07-09T18:00:00Z");

    writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic);

    expect(readCachedMobileOptimisticTranscript(sessionId)).toEqual([optimistic]);
    expect(mergeCachedMobileOptimisticTranscript(sessionId, [])).toEqual([optimistic]);

    clearCachedMobileOptimisticTranscript(sessionId);
  });

  test("reconciles a local user message when the gateway persists it under a new id", () => {
    const sessionId = `mobile-transcript-ack-${Date.now()}`;
    const optimistic = userMessage("local-1", "keep this visible", "2026-07-09T18:00:00Z");
    const persisted = userMessage("gateway-1", "keep this visible", "2026-07-09T18:00:01Z");
    writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic);

    expect(mergeCachedMobileOptimisticTranscript(sessionId, [persisted])).toEqual([persisted]);
    expect(readCachedMobileOptimisticTranscript(sessionId)).toEqual([]);
  });

  test("does not duplicate repeated text from an older turn", () => {
    const sessionId = `mobile-transcript-repeat-${Date.now()}`;
    const optimistic = userMessage("local-2", "continue", "2026-07-09T18:30:00Z");
    const older = userMessage("gateway-old", "continue", "2026-07-09T17:00:00Z");
    writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic);

    expect(mergeCachedMobileOptimisticTranscript(sessionId, [older])).toEqual([older, optimistic]);

    clearCachedMobileOptimisticTranscript(sessionId);
  });

  test("treats a later persisted assistant reply as acknowledgement", () => {
    const sessionId = `mobile-transcript-final-${Date.now()}`;
    const optimistic = userMessage("local-3", "finish the task", "2026-07-09T18:00:00Z");
    const finalReply: SessionMessageSummary = {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      timestamp: "2026-07-09T18:01:00Z",
    };
    writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic);

    expect(mergeCachedMobileOptimisticTranscript(sessionId, [finalReply])).toEqual([finalReply]);
    expect(readCachedMobileOptimisticTranscript(sessionId)).toEqual([]);
  });
});
