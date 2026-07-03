import { describe, expect, test } from "bun:test";
import {
  absoluteTimestampLabel,
  agentIsRunning,
  arraySettingCount,
  booleanSetting,
  endpointStatusLabel,
  monitorPercent,
  monitorPercentLabel,
  objectRecord,
  relativeTimestamp,
  remoteItemEnabled,
  remoteTaskRunning,
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

describe("monitor helpers", () => {
  test("monitorPercent clamps to 0..100 and defaults non-finite to 0", () => {
    expect(monitorPercent(42)).toBe(42);
    expect(monitorPercent(-5)).toBe(0);
    expect(monitorPercent(150)).toBe(100);
    expect(monitorPercent(null)).toBe(0);
    expect(monitorPercent(undefined)).toBe(0);
  });

  test("monitorPercentLabel formats or shows n/a", () => {
    expect(monitorPercentLabel(12.34)).toBe("12.3%");
    expect(monitorPercentLabel(null)).toBe("n/a");
  });
});

describe("agent + remote status helpers", () => {
  test("agentIsRunning treats running/active as running", () => {
    expect(agentIsRunning({ status: "running" } as never)).toBe(true);
    expect(agentIsRunning({ status: "active" } as never)).toBe(true);
    expect(agentIsRunning({ status: "stopped" } as never)).toBe(false);
    expect(agentIsRunning(null)).toBe(false);
  });

  test("remoteItemEnabled honors explicit enabled then status", () => {
    expect(remoteItemEnabled({ enabled: false } as never)).toBe(false);
    expect(remoteItemEnabled({ status: "paused" } as never)).toBe(false);
    expect(remoteItemEnabled({ status: "ready" } as never)).toBe(true);
    expect(remoteItemEnabled({} as never)).toBe(true);
  });

  test("remoteTaskRunning detects active-ish statuses", () => {
    expect(remoteTaskRunning({ status: "running" } as never)).toBe(true);
    expect(remoteTaskRunning({ status: "pending" } as never)).toBe(true);
    expect(remoteTaskRunning({ status: "failed" } as never)).toBe(false);
    expect(remoteTaskRunning({} as never)).toBe(false);
  });
});

describe("record + settings helpers", () => {
  test("objectRecord returns plain objects only", () => {
    expect(objectRecord({ a: 1 })).toEqual({ a: 1 });
    expect(objectRecord(null)).toBeNull();
    expect(objectRecord([1, 2])).toBeNull();
    expect(objectRecord("x")).toBeNull();
  });

  test("booleanSetting reads strict true", () => {
    expect(booleanSetting({ flag: true }, "flag")).toBe(true);
    expect(booleanSetting({ flag: "true" }, "flag")).toBe(false);
    expect(booleanSetting(null, "flag")).toBe(false);
  });

  test("arraySettingCount pluralizes entries", () => {
    expect(arraySettingCount({ items: [] }, "items")).toBe("None");
    expect(arraySettingCount({ items: [1] }, "items")).toBe("1 entry");
    expect(arraySettingCount({ items: [1, 2, 3] }, "items")).toBe("3 entries");
    expect(arraySettingCount(null, "items")).toBe("None");
  });

  test("endpointStatusLabel reflects endpoint availability", () => {
    expect(endpointStatusLabel(undefined)).toBe("Loading");
    expect(endpointStatusLabel({ ok: true })).toBe("Online");
    expect(endpointStatusLabel({ ok: false, status: 401 })).toBe("Unavailable (401)");
    expect(endpointStatusLabel({ ok: false })).toBe("Unavailable");
  });
});
