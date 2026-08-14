import { describe, expect, test } from "bun:test";
import { mergeSessionDetailIntoSummary } from "../../apps/mobile/src/lib/dashboard";
import type { FeatureSummary, SessionDetailSummary } from "../../apps/mobile/src/lib/api";

describe("mobile session summary reconciliation", () => {
  test("updates the open chat from hydrated transcript detail", () => {
    const summary = {
      sessions: [
        {
          id: "session-1",
          title: "Old title",
          message_count: 2,
          updated_at: "2026-07-23T01:00:00.000Z",
          last_message: { role: "assistant", content: "Old response" },
        },
      ],
    } as FeatureSummary;
    const detail = {
      id: "session-1",
      title: "Updated title",
      updatedAt: "2026-07-23T02:00:00.000Z",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Question",
          timestamp: "2026-07-23T01:00:00Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Answer",
          timestamp: "2026-07-23T01:01:00Z",
        },
        {
          id: "m3",
          role: "user",
          content: "Next",
          timestamp: "2026-07-23T01:02:00Z",
        },
        {
          id: "m4",
          role: "assistant",
          content: "Done",
          timestamp: "2026-07-23T02:00:00Z",
        },
      ],
    } as SessionDetailSummary;

    const result = mergeSessionDetailIntoSummary(summary, detail);
    expect(result?.sessions[0]).toMatchObject({
      title: "Updated title",
      message_count: 4,
      updated_at: "2026-07-23T02:00:00.000Z",
      last_message: { role: "assistant", content: "Done" },
    });
  });

  test("leaves unrelated or unavailable summaries unchanged", () => {
    const detail = {
      id: "missing",
      title: null,
      messages: [],
    } as SessionDetailSummary;
    const summary = { sessions: [] } as FeatureSummary;

    expect(mergeSessionDetailIntoSummary(null, detail)).toBeNull();
    expect(mergeSessionDetailIntoSummary(summary, detail)).toBe(summary);
  });

  test("preserves summary identity when hydrated detail has no visible changes", () => {
    const summary = {
      sessions: [
        {
          id: "session-1",
          title: "Complete",
          message_count: 1,
          updated_at: "2026-08-13T12:00:00.000Z",
          last_message: { role: "assistant", content: "Done" },
        },
      ],
    } as FeatureSummary;
    const detail = {
      id: "session-1",
      title: "Complete",
      updatedAt: "2026-08-13T12:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Done",
          timestamp: "2026-08-13T12:00:00.000Z",
        },
      ],
    } as SessionDetailSummary;

    expect(mergeSessionDetailIntoSummary(summary, detail)).toBe(summary);
  });
});
