import { describe, expect, test } from "bun:test";
import { ReplayGuard, parseTimestampSeconds } from "../../src/core/channels/replay-guard";

describe("ReplayGuard", () => {
  test("accepts a fresh unique request", () => {
    let now = 1_000_000;
    const guard = new ReplayGuard({ now: () => now });
    expect(guard.check("nonce-1", now).ok).toBe(true);
  });

  test("rejects a replayed nonce+timestamp", () => {
    let now = 1_000_000;
    const guard = new ReplayGuard({ now: () => now });
    expect(guard.check("nonce-1", now).ok).toBe(true);
    const replay = guard.check("nonce-1", now);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("replayed nonce");
  });

  test("rejects a stale timestamp beyond skew", () => {
    let now = 10_000_000;
    const guard = new ReplayGuard({ maxSkewMs: 60_000, now: () => now });
    const result = guard.check("nonce-1", now - 120_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stale timestamp");
  });

  test("rejects future timestamp beyond skew", () => {
    let now = 10_000_000;
    const guard = new ReplayGuard({ maxSkewMs: 60_000, now: () => now });
    expect(guard.check("nonce-1", now + 120_000).ok).toBe(false);
  });

  test("rejects missing nonce and invalid timestamp", () => {
    const guard = new ReplayGuard();
    expect(guard.check("", Date.now()).ok).toBe(false);
    expect(guard.check("nonce", Number.NaN).ok).toBe(false);
  });

  test("allows same nonce again once original entry expires", () => {
    let now = 1_000_000;
    const guard = new ReplayGuard({ maxSkewMs: 10_000_000, ttlMs: 1000, now: () => now });
    expect(guard.check("nonce-1", 1_000_000).ok).toBe(true);
    now = 1_002_000;
    expect(guard.check("nonce-2", 1_002_000).ok).toBe(true);
    expect(guard.check("nonce-1", 1_000_000).ok).toBe(true);
  });

  test("parseTimestampSeconds converts seconds to ms", () => {
    expect(parseTimestampSeconds("1700000000")).toBe(1_700_000_000_000);
    expect(Number.isNaN(parseTimestampSeconds("not-a-number"))).toBe(true);
  });
});
