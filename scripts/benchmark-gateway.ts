import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface LatencySummary {
  requests: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface GatewayBenchmarkReport {
  generatedAt: string;
  platform: string;
  arch: string;
  bunVersion: string;
  startupMs: number;
  sequential: Record<string, LatencySummary>;
  concurrent: Record<string, LatencySummary>;
}

function quantile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function summarize(values: number[]): LatencySummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    requests: sorted.length,
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    p50Ms: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    p99Ms: round(quantile(sorted, 0.99)),
  };
}

function reservePort(): number {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(): void {},
    },
  });
  const port = listener.port;
  listener.stop(true);
  return port;
}

async function waitForGateway(baseUrl: string, timeoutMs: number): Promise<number> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      await response.arrayBuffer();
      if (response.ok) return performance.now() - startedAt;
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error(`Gateway did not become ready within ${timeoutMs}ms`);
}

async function measureRequest(
  baseUrl: string,
  path: string,
  headers: Record<string, string>
): Promise<number> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { headers });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return performance.now() - startedAt;
}

async function measureSequential(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  requests: number,
  warmup: number
): Promise<LatencySummary> {
  for (let index = 0; index < warmup; index++) {
    await measureRequest(baseUrl, path, headers);
  }
  const values: number[] = [];
  for (let index = 0; index < requests; index++) {
    values.push(await measureRequest(baseUrl, path, headers));
  }
  return summarize(values);
}

async function measureConcurrent(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  requests: number,
  concurrency: number
): Promise<LatencySummary> {
  const values: number[] = [];
  for (let offset = 0; offset < requests; offset += concurrency) {
    const width = Math.min(concurrency, requests - offset);
    values.push(
      ...(await Promise.all(
        Array.from({ length: width }, () => measureRequest(baseUrl, path, headers))
      ))
    );
  }
  return summarize(values);
}

async function main(): Promise<void> {
  const quick = Bun.argv.includes("--quick");
  const json = Bun.argv.includes("--json");
  const home = mkdtempSync(join(tmpdir(), "cybara-gateway-benchmark-"));
  const port = reservePort();
  const apiKey = `cybara_benchmark_${crypto.randomUUID()}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const entry = Bun.argv.includes("--source") ? "src/index.ts" : "dist/index.js";
  const process = Bun.spawn([Bun.which("bun") ?? "bun", "run", entry], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...globalThis.process.env,
      HOME: home,
      USERPROFILE: home,
      PORT: String(port),
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: apiKey,
      NODE_ENV: "production",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const startupMs = await waitForGateway(baseUrl, 30_000);
    const headers = { Authorization: `Bearer ${apiKey}` };
    const report: GatewayBenchmarkReport = {
      generatedAt: new Date().toISOString(),
      platform: globalThis.process.platform,
      arch: globalThis.process.arch,
      bunVersion: Bun.version,
      startupMs: round(startupMs),
      sequential: {
        health: await measureSequential(baseUrl, "/api/health/live", headers, quick ? 10 : 300, 3),
        info: await measureSequential(baseUrl, "/api/info", headers, quick ? 5 : 100, 3),
        sessions: await measureSequential(
          baseUrl,
          "/api/chat/sessions?limit=150&offset=0",
          headers,
          quick ? 3 : 30,
          3
        ),
      },
      concurrent: {
        health: await measureConcurrent(baseUrl, "/api/health/live", headers, quick ? 10 : 400, 20),
        info: await measureConcurrent(baseUrl, "/api/info", headers, quick ? 5 : 80, 20),
        sessions: await measureConcurrent(
          baseUrl,
          "/api/chat/sessions?limit=150&offset=0",
          headers,
          quick ? 3 : 20,
          10
        ),
      },
    };
    if (json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    process.kill("SIGTERM");
    await Promise.race([process.exited, Bun.sleep(2_000)]);
    rmSync(home, { recursive: true, force: true });
  }
}

await main();
