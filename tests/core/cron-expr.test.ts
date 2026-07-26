import { describe, expect, test } from "bun:test";
import { parseCronExpression, nextCronRun } from "../../src/core/cron/cron-expr";

function at(iso: string): number {
  return new Date(iso).getTime();
}

describe("cron expression parsing", () => {
  test("rejects wrong field counts", () => {
    expect(() => parseCronExpression("* * * *")).toThrow();
    expect(() => parseCronExpression("* * * * * *")).toThrow();
  });

  test("parses wildcards as unrestricted", () => {
    const f = parseCronExpression("* * * * *");
    expect(f.domRestricted).toBe(false);
    expect(f.dowRestricted).toBe(false);
    expect(f.minute.size).toBe(60);
    expect(f.hour.size).toBe(24);
  });

  test("parses ranges, steps, lists, and names", () => {
    const f = parseCronExpression("0,30 9-17 * jan-mar mon-fri");
    expect([...f.minute].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...f.hour].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...f.month].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect([...f.dow].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("*/n step", () => {
    const f = parseCronExpression("*/15 * * * *");
    expect([...f.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  test("sunday accepts both 0 and 7", () => {
    expect(parseCronExpression("0 0 * * 7").dow.has(0)).toBe(true);
    expect(parseCronExpression("0 0 * * 0").dow.has(0)).toBe(true);
  });
});

describe("nextCronRun (UTC)", () => {
  const TZ = "UTC";

  test("every minute -> next whole minute", () => {
    const from = at("2026-06-30T10:15:30Z");
    expect(nextCronRun("* * * * *", from, TZ)).toBe(at("2026-06-30T10:16:00Z"));
  });

  test("top of next hour", () => {
    const from = at("2026-06-30T10:15:00Z");
    expect(nextCronRun("0 * * * *", from, TZ)).toBe(at("2026-06-30T11:00:00Z"));
  });

  test("specific time of day rolls to tomorrow when passed", () => {
    const from = at("2026-06-30T10:15:00Z");
    expect(nextCronRun("30 9 * * *", from, TZ)).toBe(at("2026-07-01T09:30:00Z"));
  });

  test("day-of-week target (next Monday 00:00)", () => {
    const from = at("2026-06-30T10:15:00Z");
    expect(nextCronRun("0 0 * * mon", from, TZ)).toBe(at("2026-07-06T00:00:00Z"));
  });

  test("DOM+DOW both restricted use OR semantics", () => {
    const from = at("2026-06-30T10:15:00Z");
    expect(nextCronRun("0 0 1 * fri", from, TZ)).toBe(at("2026-07-01T00:00:00Z"));
    expect(nextCronRun("0 0 1 * fri", at("2026-07-01T12:00:00Z"), TZ)).toBe(
      at("2026-07-03T00:00:00Z")
    );
  });

  test("invalid expression throws", () => {
    expect(() => nextCronRun("bogus * * * *", at("2026-06-30T10:00:00Z"), TZ)).toThrow();
  });
});
