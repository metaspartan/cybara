import { describe, expect, test } from "bun:test";
import type { SessionPlanSnapshot } from "../../ui/src/types";
import {
  extractLatestPlanFromMessages,
  isSessionPlanComplete,
  mergeSessionPlanState,
  parsePlanFromToolCall,
  sessionPlanCurrentTask,
  sessionPlanProgressLabel,
  shouldShowSessionPlanInComposer,
  summarizePlanItems,
  type ChatMessage,
  type SessionPlanState,
} from "../../ui/src/pages/chat/chatModel";

function plan(
  revision = 1,
  lifecycle: SessionPlanSnapshot["lifecycle"] = "active"
): SessionPlanSnapshot {
  const items: SessionPlanSnapshot["items"] = [
    { content: "Done", status: "completed", priority: "high" },
    { content: "Implement", status: "in_progress", priority: "high" },
    { content: "Verify", status: "pending", priority: "medium" },
  ];
  return {
    sessionId: "session-a",
    items,
    summary: summarizePlanItems(items),
    source: "todo_tool",
    revision,
    lifecycle,
    updatedAt: "2026-10-01T12:00:00.000Z",
    runId: "run-a",
  };
}
function initial(snapshot: SessionPlanSnapshot | null = null): SessionPlanState {
  return { plan: snapshot, revision: null, updatedAt: 0, authoritative: false };
}
function message(snapshot: SessionPlanSnapshot): ChatMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: "2026-10-01T11:00:00.000Z",
    tool_calls: [
      { id: "todo-1", name: "todo", arguments: { items: snapshot.items }, result: snapshot },
    ],
  };
}

describe("live plan lifecycle", () => {
  test("authoritative revisions replace transcript and resist late revisions", () => {
    const current = mergeSessionPlanState(initial(plan(9)), plan(3));
    expect(current.plan?.revision).toBe(3);
    const latest = mergeSessionPlanState(current, plan(5, "paused"));
    expect(mergeSessionPlanState(latest, plan(4), Date.now())).toBe(latest);
    expect(mergeSessionPlanState(latest, plan(5, "paused"))).toBe(latest);
    const legacy = plan();
    delete legacy.revision;
    expect(mergeSessionPlanState(latest, legacy, Date.now())).toBe(latest);
  });
  test("null clears persisted state and stale snapshots cannot revive it", () => {
    expect(mergeSessionPlanState(initial(plan()), null).plan).toBeNull();
    const current = mergeSessionPlanState(initial(), plan(5));
    const cleared = mergeSessionPlanState(current, null, Date.now());
    expect(cleared.plan).toBeNull();
    expect(mergeSessionPlanState(cleared, plan(4))).toBe(cleared);
    expect(mergeSessionPlanState(cleared, plan(5))).toBe(cleared);
    expect(mergeSessionPlanState(cleared, plan(6)).plan?.revision).toBe(6);
    const empty = { ...plan(7, "cleared"), items: [], summary: summarizePlanItems([]) };
    expect(mergeSessionPlanState(cleared, empty).plan).toEqual(empty);
  });
  test("revision wins array order and result metadata is retained", () => {
    const latest = extractLatestPlanFromMessages(
      [message(plan(5, "paused")), message(plan(3))],
      "session-a"
    );
    expect(latest?.revision).toBe(5);
    expect(latest?.lifecycle).toBe("paused");
    expect(latest?.updatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(latest?.runId).toBe("run-a");
    expect(
      extractLatestPlanFromMessages([message({ ...plan(), sessionId: "other" })], "session-a")
    ).toBeNull();
  });
  test("failed and in-flight calls cannot replace successful plans", () => {
    const valid = message(plan(1));
    const invalid = message(plan(8));
    const tool = invalid.tool_calls?.[0];
    if (!tool) throw new Error("Missing fixture");
    for (const status of ["error", "blocked", "pending", "executing"] as const) {
      tool.status = status;
      expect(extractLatestPlanFromMessages([valid, invalid], "session-a")?.revision).toBe(1);
    }
    tool.status = "completed";
    tool.result = { success: false, items: plan().items };
    expect(extractLatestPlanFromMessages([invalid], "session-a")).toBeNull();
  });
  test("legacy argument plans remain valid and malformed plans are ignored", () => {
    const tool = message(plan()).tool_calls?.[0];
    if (!tool) throw new Error("Missing fixture");
    expect(parsePlanFromToolCall({ ...tool, result: undefined }, "session-a")?.items).toHaveLength(
      3
    );
    expect(
      parsePlanFromToolCall(
        { ...tool, result: undefined, arguments: { items: "bad" } },
        "session-a"
      )
    ).toBeNull();
    expect(extractLatestPlanFromMessages([], "session-a")).toBeNull();
  });
  test("terminal labels retain unfinished statuses rather than claiming completion", () => {
    const paused = plan(2, "paused");
    const ended = plan(3, "needs_update");
    expect(sessionPlanProgressLabel(paused)).toBe("Paused · 2 tasks remain");
    expect(sessionPlanProgressLabel(ended)).toBe("Turn ended · 2 tasks need an update");
    expect(ended.items[1]?.status).toBe("in_progress");
    expect(isSessionPlanComplete(ended)).toBe(false);
    expect(shouldShowSessionPlanInComposer(paused, true, null)).toBe(false);
    expect(shouldShowSessionPlanInComposer(ended, true, null)).toBe(false);
    expect(sessionPlanCurrentTask(plan())).toBe("Implement");
  });
  test("completed and all-cancelled plans have no current task", () => {
    for (const status of ["completed", "cancelled"] as const) {
      const settled = plan();
      settled.items = settled.items.map((item) => ({ ...item, status }));
      settled.summary = summarizePlanItems(settled.items);
      expect(isSessionPlanComplete(settled)).toBe(true);
      expect(sessionPlanCurrentTask(settled)).toBe("No active task");
      expect(sessionPlanProgressLabel(settled)).toBe(
        status === "cancelled" ? "Plan cancelled" : "3/3 complete"
      );
    }
  });
  test("mixed cancellation excludes cancelled tasks and handles empty zero totals", () => {
    const mixed = plan();
    mixed.items = [
      { content: "Done", status: "completed", priority: "high" },
      { content: "Dropped", status: "cancelled", priority: "low" },
    ];
    mixed.summary = summarizePlanItems(mixed.items);
    expect(sessionPlanProgressLabel(mixed)).toBe("1/1 complete");
    expect(isSessionPlanComplete(mixed)).toBe(true);
    const empty = { ...plan(), items: [], summary: summarizePlanItems([]) };
    expect(sessionPlanProgressLabel(empty)).toBe("No tasks");
    expect(isSessionPlanComplete(empty)).toBe(false);
    expect(sessionPlanProgressLabel({ ...empty, lifecycle: "cleared" })).toBe("Plan cleared");
    expect(isSessionPlanComplete({ ...empty, lifecycle: "cleared" })).toBe(true);
  });
});

test("recovered paused revisions supersede active SSE envelopes even when their clock is older", () => {
  const items: SessionPlanSnapshot["items"] = [
    { content: "unfinished", status: "in_progress", priority: "high" },
  ];
  const active: SessionPlanSnapshot = {
    sessionId: "recover",
    items,
    summary: summarizePlanItems(items),
    source: "todo_tool",
    revision: 7,
    lifecycle: "active",
    updatedAt: "2026-10-01T10:00:00Z",
  };
  const received = mergeSessionPlanState(
    { plan: null, revision: null, updatedAt: 0, authoritative: false },
    active,
    Date.parse(active.updatedAt ?? "") + 1
  );
  const paused = { ...active, lifecycle: "paused" as const, revision: 8 };
  const recovered = mergeSessionPlanState(received, paused);
  expect(recovered.plan?.lifecycle).toBe("paused");
  expect(mergeSessionPlanState(recovered, active, Date.now())).toBe(recovered);
  expect(mergeSessionPlanState(recovered, paused)).toBe(recovered);
});
