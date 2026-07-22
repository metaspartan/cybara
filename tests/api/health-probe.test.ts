import { describe, expect, test } from "bun:test";
import { createLivenessPayload, isLivenessProbe } from "../../src/api/health-probe";

describe("gateway liveness probe", () => {
  test("matches only the public GET liveness endpoint", () => {
    expect(isLivenessProbe("GET", "/api/health/live")).toBe(true);
    expect(isLivenessProbe("HEAD", "/api/health/live")).toBe(false);
    expect(isLivenessProbe("GET", "/api/health/ready")).toBe(false);
    expect(isLivenessProbe("GET", "/api/health/live/extra")).toBe(false);
  });

  test("preserves the existing response contract", () => {
    const payload = createLivenessPayload(new Date("2026-07-22T00:00:00.000Z"));
    expect(payload).toEqual({
      live: true,
      timestamp: "2026-07-22T00:00:00.000Z",
    });
  });
});
