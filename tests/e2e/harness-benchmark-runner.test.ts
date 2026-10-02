import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
let upstream: ReturnType<typeof Bun.serve> | undefined;
let requests = 0;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cybara-harness-runner-"));
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer private-evaluation-fixture-key");
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.model).toBe("fixture-evaluation-model");
      expect(body.stream).toBe(false);
      requests += 1;
      return Response.json({
        id: "fixture-completion",
        object: "chat.completion",
        created: 1,
        model: "fixture-evaluation-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"result":7}' },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      });
    },
  });
  await Bun.write(
    join(root, "adapter.ts"),
    'const workspace=process.env.HARNESS_BENCH_WORKSPACE;const proxy=process.env.HARNESS_BENCH_PROXY_URL;if(!workspace||!proxy||process.env.FIXTURE_UPSTREAM_KEY)throw new Error("Invalid isolated adapter environment");const response=await fetch(proxy+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:process.env.HARNESS_BENCH_MODEL,messages:[{role:"user",content:"fixture"}],stream:true})});const stream=await response.text();const chunks=stream.split("\\n\\n").filter(part=>part.startsWith("data: ")&&!part.includes("[DONE]")).map(part=>JSON.parse(part.slice(6)));const text=chunks.map(chunk=>chunk.choices[0]?.delta?.content??"").join("");await Bun.write(workspace+"/answer.json",text);'
  );
  await Bun.write(
    join(root, "config.json"),
    JSON.stringify({
      output_dir: join(root, "output"),
      model: "fixture-evaluation-model",
      provider_url: `http://127.0.0.1:${upstream.port}/v1`,
      provider_key_env: "FIXTURE_UPSTREAM_KEY",
      rounds: 1,
      tasks: [
        {
          id: "fixture",
          prompt: "Create answer.json",
          files: [{ path: "input.json", content: "[3,4]" }],
          assertions: [{ kind: "file_json", path: "answer.json", expected: { result: 7 } }],
        },
      ],
      harnesses: [
        {
          id: "candidate",
          kind: "command",
          command: [process.execPath, join(root, "adapter.ts")],
          timeout_ms: 10_000,
        },
      ],
    })
  );
});
afterAll(() => {
  upstream?.stop(true);
  if (root) rmSync(root, { recursive: true, force: true });
});

test("the real benchmark CLI intercepts a model request, scores the output, totals usage and keeps credentials out of the child and report", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "scripts/harness-benchmark.ts",
      "--config",
      join(root, "config.json"),
    ],
    {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, FIXTURE_UPSTREAM_KEY: "private-evaluation-fixture-key" },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(error).toBe("");
  expect(code).toBe(0);
  expect(requests).toBe(1);
  const raw = await Bun.file(join(root, "output", "result.json")).text();
  const report = JSON.parse(raw) as {
    totals: { passed_runs: number };
    harnesses: Array<{
      usage: { prompt_tokens: number; completion_tokens: number; cache_read_tokens: number };
    }>;
  };
  expect(report.totals.passed_runs).toBe(1);
  expect(report.harnesses[0]?.usage).toMatchObject({
    prompt_tokens: 100,
    completion_tokens: 5,
    cache_read_tokens: 80,
  });
  expect(raw).not.toContain("private-evaluation-fixture-key");
  expect(output).toContain("passed=1/1");
  const second = Bun.spawn(
    [
      process.execPath,
      "run",
      "scripts/harness-benchmark.ts",
      "--config",
      join(root, "config.json"),
    ],
    {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, FIXTURE_UPSTREAM_KEY: "private-evaluation-fixture-key" },
      stdout: "ignore",
      stderr: "pipe",
    }
  );
  const [secondError, secondCode] = await Promise.all([
    new Response(second.stderr).text(),
    second.exited,
  ]);
  expect(secondCode).toBe(1);
  expect(secondError).toContain("fresh output directory");
  expect(requests).toBe(1);
}, 30_000);
