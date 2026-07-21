import { describe, expect, test } from "bun:test";
import {
  acceptsMultiChatDrag,
  addMultiChatSession,
  buildMultiChatPath,
  isMultiChatSearch,
  MULTI_CHAT_DRAG_TYPE,
  normalizeMultiChatSessionIds,
  parseMultiChatSessionIds,
  readMultiChatDragSessionId,
  readPersistedMultiChatSessionIds,
  reorderMultiChatSessions,
  replaceMultiChatSession,
  resolveMultiChatDropIndex,
  resolveMultiChatSlotCount,
} from "../../ui/src/pages/chat/multiChatLayout";

describe("multi-chat layout", () => {
  test("normalizes unique bounded pane session ids", () => {
    expect(normalizeMultiChatSessionIds(["a", " a ", "", "b", "c", "d", "e"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("round trips pane ids through the chat URL", () => {
    const path = buildMultiChatPath(["session a", "session/b"]);
    const search = path.slice(path.indexOf("?"));
    expect(isMultiChatSearch(search)).toBe(true);
    expect(parseMultiChatSessionIds(search)).toEqual(["session a", "session/b"]);
  });

  test("adds, replaces, and reorders panes without duplicates", () => {
    expect(addMultiChatSession(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(addMultiChatSession(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(replaceMultiChatSession(["a", "b", "c"], 1, "c")).toEqual(["a", "c"]);
    expect(reorderMultiChatSessions(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  test("fails closed when persisted state is malformed", () => {
    const storage = {
      getItem: () => "not-json",
    } as Storage;
    expect(readPersistedMultiChatSessionIds(storage)).toEqual([]);
  });

  test("expands two panes into four destinations only while dragging a chat", () => {
    expect(resolveMultiChatSlotCount(1, false)).toBe(2);
    expect(resolveMultiChatSlotCount(2, false)).toBe(2);
    expect(resolveMultiChatSlotCount(2, true)).toBe(4);
    expect(resolveMultiChatSlotCount(3, false)).toBe(4);
  });

  test("accepts only the Cybara chat drag payload", () => {
    expect(acceptsMultiChatDrag(["text/plain", MULTI_CHAT_DRAG_TYPE])).toBe(true);
    expect(acceptsMultiChatDrag([MULTI_CHAT_DRAG_TYPE.toUpperCase()])).toBe(true);
    expect(acceptsMultiChatDrag(["text/plain", "Files"])).toBe(false);
  });

  test("reads the plain-text fallback only for a marked Cybara chat drag", () => {
    const values = new Map([
      [MULTI_CHAT_DRAG_TYPE, ""],
      ["text/plain", "session-3"],
    ]);
    expect(
      readMultiChatDragSessionId({
        getData: (type) => values.get(type) ?? "",
        types: [MULTI_CHAT_DRAG_TYPE, "text/plain"],
      })
    ).toBe("session-3");
    expect(
      readMultiChatDragSessionId({
        getData: (type) => values.get(type) ?? "",
        types: ["text/plain"],
      })
    ).toBe("");
  });

  test("resolves all four quadrants and maps grid gaps to the nearest pane", () => {
    const rects = [
      { index: 0, left: 0, right: 95, top: 0, bottom: 95 },
      { index: 1, left: 105, right: 200, top: 0, bottom: 95 },
      { index: 2, left: 0, right: 95, top: 105, bottom: 200 },
      { index: 3, left: 105, right: 200, top: 105, bottom: 200 },
    ];
    expect(resolveMultiChatDropIndex(25, 25, rects)).toBe(0);
    expect(resolveMultiChatDropIndex(175, 25, rects)).toBe(1);
    expect(resolveMultiChatDropIndex(25, 175, rects)).toBe(2);
    expect(resolveMultiChatDropIndex(175, 175, rects)).toBe(3);
    expect(resolveMultiChatDropIndex(102, 150, rects)).toBe(3);
    expect(resolveMultiChatDropIndex(0, 0, [])).toBeNull();
  });
});
