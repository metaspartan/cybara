import { describe, expect, test } from "bun:test";
import {
  absoluteTimestampLabel,
  relativeTimestamp,
} from "../../apps/mobile/src/screens/dashboardHelpers";

describe("relativeTimestamp", () => {
  test("formats recent times in coarse buckets", () => {
    const now = Date.now();
    expect(relativeTimestamp(new Date(now - 10_000).toISOString())).toBe("just now");
    expect(relativeTimestamp(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTimestamp(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTimestamp(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });

  test("falls back to 'recent' for unparseable input", () => {
    expect(relativeTimestamp("not a date")).toBe("recent");
    expect(relativeTimestamp("")).toBe("recent");
  });
});

describe("absoluteTimestampLabel", () => {
  test("returns Unknown for missing input", () => {
    expect(absoluteTimestampLabel(undefined)).toBe("Unknown");
    expect(absoluteTimestampLabel("")).toBe("Unknown");
  });

  test("echoes the raw value when unparseable", () => {
    expect(absoluteTimestampLabel("not-a-date")).toBe("not-a-date");
  });

  test("renders a locale string for a valid timestamp", () => {
    const label = absoluteTimestampLabel("2026-02-18T10:00:00.000Z");
    expect(label).not.toBe("Unknown");
    expect(label.length).toBeGreaterThan(0);
  });
});
