import { describe, expect, test } from "bun:test";
import { cn, formatRelativeTime, formatDate, truncate } from "./utils";

describe("cn", () => {
  test("merges multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  test("drops falsy and conditional values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cn("a", true && "b", false && "c")).toBe("a b");
  });

  test("flattens array inputs", () => {
    expect(cn(["a", "b"], ["c"])).toBe("a b c");
    expect(cn(["a", false && "b", "c"])).toBe("a c");
  });

  test("handles object conditional inputs", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  test("tailwind-merge dedupes conflicting utilities, last wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  test("keeps non-conflicting tailwind classes", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  test("no arguments yields empty string", () => {
    expect(cn()).toBe("");
  });
});

describe("formatRelativeTime", () => {
  test("undefined returns empty string", () => {
    expect(formatRelativeTime(undefined)).toBe("");
    expect(formatRelativeTime("")).toBe("");
  });

  test('under a minute is "just now"', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  test("minutes ago", () => {
    const d = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe("5m ago");
  });

  test("hours ago", () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe("3h ago");
  });

  test("days ago", () => {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe("2d ago");
  });

  test("a week or more falls back to a locale date string", () => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(d);
    expect(result).not.toBe("just now");
    expect(result).not.toMatch(/ago$/);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatDate", () => {
  test("undefined returns empty string", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  test("returns a non-empty locale string for a valid date", () => {
    const result = formatDate("2026-01-01T00:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("truncate", () => {
  test("returns input untouched when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("truncates and appends ellipsis when over limit", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  test("empty string returns empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  test("unicode content is handled without throwing", () => {
    const emoji = "😀😀😀😀😀😀";
    expect(() => truncate(emoji, 3)).not.toThrow();
  });
});
