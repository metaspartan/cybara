import { describe, expect, test } from "bun:test";
import { RecentMessageIds } from "../../src/core/channels/recent-message-ids";

describe("RecentMessageIds", () => {
  test("rejects duplicates until their retention window expires", () => {
    const ids = new RecentMessageIds(100, 10);
    expect(ids.accept("channel:message", 1_000)).toBe(true);
    expect(ids.accept("channel:message", 1_050)).toBe(false);
    expect(ids.accept("channel:message", 1_101)).toBe(true);
  });

  test("bounds retained identifiers", () => {
    const ids = new RecentMessageIds(10_000, 2);
    expect(ids.accept("one", 1)).toBe(true);
    expect(ids.accept("two", 2)).toBe(true);
    expect(ids.accept("three", 3)).toBe(true);
    expect(ids.accept("one", 4)).toBe(true);
  });
});
