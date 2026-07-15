import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface GatewayTelemetryResult {
  success: number;
  error: number;
  duration: number;
  raw: number;
  compacted: number;
  rawAfterCompaction: number;
  daily: Array<{ key: string; value: number }>;
}

describe("gateway telemetry storage", () => {
  test("records request totals and daily counts without raw request rows", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-gateway-telemetry-"));
    const metricsPath = join(import.meta.dir, "../../src/core/metrics.ts");
    const databasePath = join(import.meta.dir, "../../src/core/database.ts");
    const script = `
      import { trackApiCall } from ${JSON.stringify(metricsPath)};
      import { tables } from ${JSON.stringify(databasePath)};
      trackApiCall("/api/info", "GET", 200, 12);
      trackApiCall("/api/info", "GET", 500, 8);
      const raw = tables.metrics.count();
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "api_status",
        key: "200",
        value: 1,
        metadata: JSON.stringify({ endpoint: "/api/info" })
      });
      const compacted = tables.metrics.compactGatewayTelemetry(100);
      console.log(JSON.stringify({
        success: tables.metrics.getTotal("api_call", "success"),
        error: tables.metrics.getTotal("api_call", "error"),
        duration: tables.metrics.getTotal("api_endpoint", "GET /api/info"),
        raw,
        compacted,
        rawAfterCompaction: tables.metrics.count(),
        daily: tables.metrics.getDaily(new Date().toISOString().slice(0, 10), "api_call")
      }));
    `;
    try {
      const child = Bun.spawn([Bun.which("bun") ?? "bun", "-e", script], {
        cwd: join(import.meta.dir, "../.."),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CYBARA_HOME: join(home, ".cybara"),
          NODE_ENV: "test",
        },
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout.trim()) as GatewayTelemetryResult;
      expect(result.success).toBe(1);
      expect(result.error).toBe(1);
      expect(result.duration).toBe(20);
      expect(result.raw).toBe(0);
      expect(result.compacted).toBe(1);
      expect(result.rawAfterCompaction).toBe(0);
      expect(result.daily).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "success", value: 1 }),
          expect.objectContaining({ key: "error", value: 1 }),
        ])
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
