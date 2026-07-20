import { describe, expect, test } from "bun:test";
import {
  addMultiChatSession,
  buildMultiChatPath,
  isMultiChatSearch,
  normalizeMultiChatSessionIds,
  parseMultiChatSessionIds,
  readPersistedMultiChatSessionIds,
  reorderMultiChatSessions,
  replaceMultiChatSession,
  resolveActiveMultiChatDropIndex,
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

  test("keeps only the newest drag target active across delayed leave events", () => {
    expect(resolveActiveMultiChatDropIndex(null, 2, true)).toBe(2);
    expect(resolveActiveMultiChatDropIndex(2, 3, true)).toBe(3);
    expect(resolveActiveMultiChatDropIndex(3, 2, false)).toBe(3);
    expect(resolveActiveMultiChatDropIndex(3, 3, false)).toBeNull();
  });
});
