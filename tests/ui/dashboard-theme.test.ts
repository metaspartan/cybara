import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDashboardCheckStatus } from "../../ui/src/pages/dashboard/dashboardStatus";

const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("dashboard health state", () => {
  test("normalizes recognized health states", () => {
    expect(getDashboardCheckStatus("healthy")).toEqual({ status: "healthy" });
    expect(getDashboardCheckStatus({ status: "degraded" })).toEqual({
      status: "warning",
    });
    expect(getDashboardCheckStatus({ status: "offline" })).toEqual({
      status: "error",
    });
  });

  test("formats numeric check details and rejects malformed health payloads", () => {
    expect(getDashboardCheckStatus({ total: 12 })).toEqual({
      status: "healthy",
      details: "12 total",
    });
    expect(getDashboardCheckStatus({ heapUsed: 48 })).toEqual({
      status: "healthy",
      details: "48MB used",
    });
    expect(getDashboardCheckStatus(null)).toEqual({ status: "error" });
    expect(getDashboardCheckStatus({ total: Number.NaN })).toEqual({
      status: "error",
    });
    expect(getDashboardCheckStatus({})).toEqual({ status: "error" });
  });
});

describe("dashboard theme contract", () => {
  test("uses semantic surfaces, text, and the selected accent", () => {
    const dashboard = read("../../ui/src/pages/Dashboard.tsx");
    expect(dashboard).toContain("bg-[var(--surface-panel)]");
    expect(dashboard).toContain("hover:bg-[var(--surface-hover)]");
    expect(dashboard).toContain("border-[var(--surface-border)]");
    expect(dashboard).toContain("text-[var(--text-primary)]");
    expect(dashboard).toContain("text-[var(--text-muted)]");
    expect(dashboard).toContain("bg-[rgba(var(--accent-primary),0.12)]");
    expect(dashboard).not.toContain("bg-white/");
    expect(dashboard).not.toContain("text-white");
    expect(dashboard).not.toMatch(
      /(?:indigo|blue|emerald|violet|cyan|teal|amber|orange)-\d/,
    );
    expect(dashboard).not.toContain("bg-gradient");
  });

  test("uses flat grouped lists for quick actions and health checks", () => {
    const dashboard = read("../../ui/src/pages/Dashboard.tsx");
    expect(dashboard).toContain("divide-y divide-[var(--surface-border)]");
    expect(dashboard).toContain(
      "xl:grid-cols-[minmax(0,1.08fr)_minmax(21rem,0.92fr)]",
    );
    expect(dashboard).toContain('aria-label="Platform summary"');
  });
});
