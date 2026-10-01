import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a timed-out fixture cancels its upstream request and cannot contaminate the next run or pass from a partial output", async () => {
  const root = mkdtempSync(join(tmpdir(), "cybara-harness-timeout-"));
  let started = 0;
  let cancelled = 0;
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      started += 1;
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) {
          cancelled += 1;
          resolve();
        } else
          request.signal.addEventListener(
            "abort",
            () => {
              cancelled += 1;
              resolve();
            },
            { once: true }
          );
      });
      return new Response("cancelled");
    },
  });
  try {
    const adapter = join(root, "adapter.ts");
    await Bun.write(
      adapter,
      'const workspace=process.env.HARNESS_BENCH_WORKSPACE;await Bun.write(workspace+"/answer.json","{\\"result\\":7}");await fetch(process.env.HARNESS_BENCH_PROXY_URL+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:process.env.HARNESS_BENCH_MODEL,messages:[{role:"user",content:"fixture"}],stream:false})});'
    );
    const config = join(root, "config.json");
    await Bun.write(
      config,
      JSON.stringify({
        output_dir: join(root, "output"),
        model: "fixture-timeout",
        provider_url: `http://127.0.0.1:${upstream.port}/v1`,
        provider_key_env: "TIMEOUT_FIXTURE_KEY",
        rounds: 2,
        tasks: [
          {
            id: "fixture",
            prompt: "fixture",
            files: [],
            assertions: [{ kind: "file_json", path: "answer.json", expected: { result: 7 } }],
          },
        ],
        harnesses: [
          {
            id: "candidate",
            kind: "command",
            command: [process.execPath, adapter],
            timeout_ms: 1200,
          },
        ],
      })
    );
    const child = Bun.spawn(
      [process.execPath, "run", "scripts/harness-benchmark.ts", "--config", config],
      {
        cwd: join(import.meta.dir, "..", ".."),
        env: { ...process.env, TIMEOUT_FIXTURE_KEY: "fixture" },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("status=timeout");
    for (let attempt = 0; attempt < 50 && cancelled < 2; attempt += 1) await Bun.sleep(20);
    expect(started).toBe(2);
    expect(cancelled).toBe(2);
    const report = (await Bun.file(join(root, "output", "result.json")).json()) as {
      runs: Array<{
        run_id: string;
        status: string;
        all_passed: boolean;
        requests: Array<{ index: number; success: boolean; usage: unknown }>;
      }>;
      totals: { passed_runs: number };
    };
    expect(report.totals.passed_runs).toBe(0);
    expect(report.runs).toHaveLength(2);
    for (const run of report.runs) {
      expect(run.status).toBe("timeout");
      expect(run.all_passed).toBe(false);
      expect(run.requests).toHaveLength(1);
      expect(run.requests[0]?.success).toBe(false);
      expect(run.requests[0]?.usage).toBeNull();
    }
    expect(report.runs.map((run) => run.requests[0]?.index)).toEqual([1, 2]);
  } finally {
    upstream.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
