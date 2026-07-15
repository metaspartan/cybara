import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface BenchmarkOutput {
  startupMs: number;
  sequential: Record<string, { requests: number; p50Ms: number }>;
  concurrent: Record<string, { requests: number; p95Ms: number }>;
}

describe("gateway benchmark", () => {
  test("emits a bounded machine-readable report", async () => {
    const root = join(import.meta.dir, "../..");
    const process = Bun.spawn(
      [
        Bun.which("bun") ?? "bun",
        "run",
        "scripts/benchmark-gateway.ts",
        "--source",
        "--quick",
        "--json",
      ],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    const report = JSON.parse(stdout.trim()) as BenchmarkOutput;
    expect(report.startupMs).toBeGreaterThan(0);
    expect(report.sequential.health.requests).toBe(10);
    expect(report.sequential.info.p50Ms).toBeGreaterThanOrEqual(0);
    expect(report.concurrent.sessions.requests).toBe(3);
    expect(report.concurrent.health.p95Ms).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
