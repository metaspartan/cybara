import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BENCHMARK_LIMITS,
  BenchmarkConfigError,
  buildRunPlan,
  createProxyCollector,
  emptyUsage,
  isSafeRelativePath,
  parseBenchmarkConfig,
  parseSseStream,
  readUsage,
  reassembleCompletion,
  resolveUpstreamUrl,
  resolveWithinRoot,
  scoreAssertions,
  serializeCompletionSse,
  substituteTemplate,
  sumUsages,
  type BenchmarkConfig,
  type CompletionShape,
  type TokenUsage,
} from "../../scripts/harness-benchmark-core";

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    output_dir: "out",
    model: "space-bunny-free",
    provider_url: "https://provider.example/v1",
    provider_key_env: "PROVIDER_KEY",
    rounds: 1,
    tasks: [
      {
        id: "alpha",
        prompt: "write result.json",
        files: [{ path: "input.json", content: "{}" }],
        assertions: [{ kind: "file_json", path: "result.json", expected: { ok: true } }],
      },
    ],
    harnesses: [{ id: "h1", kind: "command", command: ["node", "agent.js", "{workspace}"] }],
    ...overrides,
  };
}

describe("parseBenchmarkConfig", () => {
  test("normalizes a valid command and gateway config", () => {
    const config = parseBenchmarkConfig(
      baseConfig({
        harnesses: [
          { id: "h1", kind: "command", command: ["node", "agent.js"] },
          {
            id: "h2",
            kind: "gateway",
            url: "http://127.0.0.1:8080",
            api_key_env: "GATEWAY_TOKEN",
            agent_id: "agent",
          },
        ],
      })
    );
    expect(config.model).toBe("space-bunny-free");
    expect(config.rounds).toBe(1);
    expect(config.tasks).toHaveLength(1);
    expect(config.harnesses.map((harness) => harness.kind)).toEqual(["command", "gateway"]);
    const command = config.harnesses[0];
    if (command?.kind !== "command") throw new Error("expected a command harness");
    expect(command.cwd_mode).toBe("workspace");
    expect(command.env).toEqual({});
    expect(command.timeout_ms).toBeGreaterThanOrEqual(BENCHMARK_LIMITS.min_timeout_ms);
  });

  test("keeps explicitly provided harness settings", () => {
    const config = parseBenchmarkConfig(
      baseConfig({
        harnesses: [
          {
            id: "h1",
            kind: "command",
            command: ["bun", "run", "entry.ts", "{proxy_url}"],
            env: { HARNESS_MODE: "bench" },
            cwd_mode: "workspace",
            timeout_ms: 45_000,
          },
        ],
      })
    );
    const harness = config.harnesses[0];
    if (harness?.kind !== "command") throw new Error("expected a command harness");
    expect(harness.env).toEqual({ HARNESS_MODE: "bench" });
    expect(harness.timeout_ms).toBe(45_000);
    expect(harness.command).toEqual(["bun", "run", "entry.ts", "{proxy_url}"]);
  });

  test("rejects unsafe file and assertion paths", () => {
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          tasks: [
            {
              id: "alpha",
              prompt: "p",
              files: [{ path: "../escape.txt", content: "x" }],
              assertions: [],
            },
          ],
        })
      )
    ).toThrow(BenchmarkConfigError);
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          tasks: [
            {
              id: "alpha",
              prompt: "p",
              files: [],
              assertions: [{ kind: "file_text", path: "C:/windows/system32", expected: "x" }],
            },
          ],
        })
      )
    ).toThrow(BenchmarkConfigError);
  });

  test("rejects invalid provider settings", () => {
    expect(() =>
      parseBenchmarkConfig(baseConfig({ provider_url: "ftp://provider.example" }))
    ).toThrow(BenchmarkConfigError);
    expect(() => parseBenchmarkConfig(baseConfig({ provider_key_env: "not-an-env" }))).toThrow(
      BenchmarkConfigError
    );
    expect(() => parseBenchmarkConfig(baseConfig({ model: "" }))).toThrow(BenchmarkConfigError);
  });

  test("rejects duplicate ids and unknown assertion kinds", () => {
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          tasks: [baseConfig().tasks, baseConfig().tasks],
        })
      )
    ).toThrow(BenchmarkConfigError);
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          tasks: [
            {
              id: "alpha",
              prompt: "p",
              files: [],
              assertions: [{ kind: "file_csv", path: "a.csv", expected: 1 }],
            },
          ],
        })
      )
    ).toThrow(BenchmarkConfigError);
  });

  test("rejects file_json assertions without an expected value", () => {
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          tasks: [
            {
              id: "alpha",
              prompt: "p",
              files: [],
              assertions: [{ kind: "file_json", path: "a.json" }],
            },
          ],
        })
      )
    ).toThrow(BenchmarkConfigError);
  });

  test("rejects invalid timeouts and empty commands", () => {
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          harnesses: [{ id: "h1", kind: "command", command: ["node"], timeout_ms: 10 }],
        })
      )
    ).toThrow(BenchmarkConfigError);
    expect(() =>
      parseBenchmarkConfig(baseConfig({ harnesses: [{ id: "h1", kind: "command", command: [] }] }))
    ).toThrow(BenchmarkConfigError);
  });

  test("rejects plans beyond the run budget", () => {
    const task = (id: string): Record<string, unknown> => ({
      id,
      prompt: "p",
      files: [],
      assertions: [{ kind: "file_text", path: "out.txt", expected: "x" }],
    });
    const harness = (id: string): Record<string, unknown> => ({
      id,
      kind: "command",
      command: ["run", id],
    });
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          rounds: 50,
          tasks: [task("a"), task("b")],
          harnesses: [harness("h1"), harness("h2")],
        })
      )
    ).toThrow(BenchmarkConfigError);
    expect(() => parseBenchmarkConfig(baseConfig({ rounds: 0 }))).toThrow(BenchmarkConfigError);
  });

  test("rejects a gateway harness missing its key environment name", () => {
    expect(() =>
      parseBenchmarkConfig(
        baseConfig({
          harnesses: [{ id: "h1", kind: "gateway", url: "http://127.0.0.1:1", agent_id: "a" }],
        })
      )
    ).toThrow(BenchmarkConfigError);
  });
});

describe("safe paths", () => {
  test("accepts confined relative paths only", () => {
    expect(isSafeRelativePath("out/result.json")).toBe(true);
    expect(isSafeRelativePath("result.json")).toBe(true);
    expect(isSafeRelativePath("../result.json")).toBe(false);
    expect(isSafeRelativePath("nested/../../result.json")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:/Windows")).toBe(false);
    expect(isSafeRelativePath("out\\result.json")).toBe(false);
    expect(isSafeRelativePath("~/secret")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("a//b")).toBe(false);
  });

  test("resolves inside the fixture root and rejects escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-safe-"));
    try {
      mkdirSync(join(root, "nested"), { recursive: true });
      writeFileSync(join(root, "nested", "value.json"), "{}", "utf8");
      expect(resolveWithinRoot(root, "nested/value.json")).not.toBeNull();
      expect(resolveWithinRoot(root, "../outside.json")).toBeNull();
      expect(resolveWithinRoot(root, "/absolute.json")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a symlink that points outside the fixture root", () => {
    const base = mkdtempSync(join(tmpdir(), "harness-link-"));
    const root = join(base, "workspace");
    const outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.json"), "{}", "utf8");
    try {
      try {
        symlinkSync(outside, join(root, "leak"), "junction");
      } catch {
        return;
      }
      expect(resolveWithinRoot(root, "leak/leak.json")).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("assertion scoring", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "harness-score-"));
    writeFileSync(join(root, "data.json"), '{ "b" : 2,\n  "a": [1, 2] }', "utf8");
    writeFileSync(join(root, "notes.txt"), "first\r\nsecond\r\n", "utf8");
    writeFileSync(join(root, "broken.json"), "{not json", "utf8");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("compares json independently of key order and formatting", () => {
    const results = scoreAssertions(root, [
      { kind: "file_json", path: "data.json", expected: { a: [1, 2], b: 2 } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.reason).toBe("ok");
  });

  test("is exact about array order and value types", () => {
    const reordered = scoreAssertions(root, [
      { kind: "file_json", path: "data.json", expected: { a: [2, 1], b: 2 } },
    ]);
    expect(reordered[0]?.passed).toBe(false);
    expect(reordered[0]?.reason).toBe("mismatch");
    const retyped = scoreAssertions(root, [
      { kind: "file_json", path: "data.json", expected: { a: ["1", "2"], b: 2 } },
    ]);
    expect(retyped[0]?.passed).toBe(false);
  });

  test("normalizes line endings for text assertions", () => {
    const results = scoreAssertions(root, [
      { kind: "file_text", path: "notes.txt", expected: "first\nsecond\n" },
    ]);
    expect(results[0]?.passed).toBe(true);
  });

  test("reports missing, invalid and unsafe targets without passing", () => {
    const results = scoreAssertions(root, [
      { kind: "file_json", path: "absent.json", expected: {} },
      { kind: "file_json", path: "broken.json", expected: {} },
      { kind: "file_json", path: "../escape.json", expected: {} },
      { kind: "file_text", path: "notes.txt", expected: "different" },
    ]);
    expect(results.map((result) => result.reason)).toEqual([
      "missing",
      "invalid_json",
      "unsafe_path",
      "mismatch",
    ]);
    expect(results.every((result) => !result.passed)).toBe(true);
  });
});

describe("token usage", () => {
  test("keeps unknown usage as null instead of zero", () => {
    const usage = readUsage({});
    expect(usage).toEqual(emptyUsage());
    expect(readUsage(null)).toBeNull();
    expect(readUsage([])).toBeNull();
  });

  test("reads standard and alias token fields", () => {
    const usage = readUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 40 },
      cache_creation_input_tokens: 5,
      completion_tokens_details: { reasoning_tokens: 7 },
    });
    expect(usage?.prompt_tokens).toBe(100);
    expect(usage?.completion_tokens).toBe(20);
    expect(usage?.total_tokens).toBe(120);
    expect(usage?.prompt_cache_hit_tokens).toBe(40);
    expect(usage?.cache_write_tokens).toBe(5);
    expect(usage?.reasoning_tokens).toBe(7);
    expect(usage?.cache_read_tokens).toBe(40);
    const aliased = readUsage({ input_tokens: 8, output_tokens: 2 });
    expect(aliased?.prompt_tokens).toBe(8);
    expect(aliased?.completion_tokens).toBe(2);
  });

  test("aggregates only complete samples and nulls out partial fields", () => {
    const full: TokenUsage = {
      ...emptyUsage(),
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    };
    const aggregate = sumUsages([full, full]);
    expect(aggregate.requests).toBe(2);
    expect(aggregate.requests_with_usage).toBe(2);
    expect(aggregate.complete).toBe(true);
    expect(aggregate.prompt_tokens).toBe(20);
    expect(aggregate.total_tokens).toBe(30);
    expect(aggregate.cache_read_tokens).toBeNull();

    const partial: TokenUsage = { ...emptyUsage(), prompt_tokens: 10 };
    const mixed = sumUsages([full, partial]);
    expect(mixed.requests_with_usage).toBe(2);
    expect(mixed.complete).toBe(true);
    expect(mixed.completion_tokens).toBeNull();
    expect(mixed.prompt_tokens).toBe(20);

    const none = sumUsages([null, null]);
    expect(none.requests).toBe(2);
    expect(none.requests_with_usage).toBe(0);
    expect(none.complete).toBe(false);
    expect(none.prompt_tokens).toBeNull();
    expect(sumUsages([]).prompt_tokens).toBeNull();
    expect(sumUsages([full, null]).prompt_tokens).toBeNull();
    expect(sumUsages([full, null]).complete).toBe(false);
  });
});

describe("round ordering", () => {
  const config = parseBenchmarkConfig(
    baseConfig({
      rounds: 2,
      tasks: [
        {
          id: "alpha",
          prompt: "p",
          files: [],
          assertions: [{ kind: "file_text", path: "out.txt", expected: "x" }],
        },
        {
          id: "beta",
          prompt: "p",
          files: [],
          assertions: [{ kind: "file_text", path: "out.txt", expected: "x" }],
        },
      ],
      harnesses: [
        { id: "x", kind: "command", command: ["a"] },
        { id: "y", kind: "command", command: ["b"] },
        { id: "z", kind: "command", command: ["c"] },
      ],
    })
  ) as BenchmarkConfig;

  test("rotates tasks and harnesses deterministically", () => {
    const plan = buildRunPlan(config, 0);
    expect(plan.map((run) => `${run.round}:${run.task_id}:${run.harness_id}`)).toEqual([
      "1:alpha:x",
      "1:alpha:y",
      "1:alpha:z",
      "1:beta:y",
      "1:beta:z",
      "1:beta:x",
      "2:beta:z",
      "2:beta:x",
      "2:beta:y",
      "2:alpha:x",
      "2:alpha:y",
      "2:alpha:z",
    ]);
    expect(plan.map((run) => run.run_id)).toEqual(
      plan.map((run) => `r${run.round}-${run.task_id}-${run.harness_id}`)
    );
    expect(plan.map((run) => run.sequence)).toEqual(plan.map((_run, index) => index));
  });

  test("the same seed reproduces order and a different seed rotates each cross-product", () => {
    const fixture = parseBenchmarkConfig({
      ...config,
      tasks: [
        {
          id: "alpha",
          prompt: "p",
          files: [],
          assertions: [{ kind: "file_text", path: "a.txt", expected: "x" }],
        },
        {
          id: "beta",
          prompt: "p",
          files: [],
          assertions: [{ kind: "file_text", path: "b.txt", expected: "x" }],
        },
      ],
      harnesses: [
        { id: "x", kind: "command", command: ["x"] },
        { id: "y", kind: "command", command: ["y"] },
      ],
    });
    expect(buildRunPlan(fixture, 0)).toEqual(buildRunPlan(fixture, 0));
    expect(buildRunPlan(fixture, 0)).not.toEqual(buildRunPlan(fixture, 1));
    expect(buildRunPlan(fixture, 0).length).toBe(fixture.rounds * 4);
    expect(buildRunPlan(fixture, 1).length).toBe(fixture.rounds * 4);
  });

  test("every task runs against every harness once per round", () => {
    const plan = buildRunPlan(config, 0);
    for (const round of [1, 2]) {
      for (const task of config.tasks) {
        const covered = plan
          .filter((run) => run.round === round && run.task_id === task.id)
          .map((run) => run.harness_id)
          .sort();
        expect(covered).toEqual([...config.harnesses].map((harness) => harness.id).sort());
      }
    }
  });
});

describe("sse serialization", () => {
  const completion: CompletionShape = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "space-bunny-free",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "done",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "write_file", arguments: '{"path":"a.json"}' },
            },
            {
              id: "call_2",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"b.json"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
  };

  test("roundtrips a completion through a valid sse stream", () => {
    const text = serializeCompletionSse(completion);
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const events = parseSseStream(text);
    expect(events).toHaveLength(8);
    expect(events.filter((event) => event.done)).toHaveLength(1);
    expect(events[events.length - 1]?.done).toBe(true);
    const reassembled = reassembleCompletion(events);
    expect(reassembled.id).toBe("chatcmpl-1");
    expect(reassembled.model).toBe("space-bunny-free");
    expect(reassembled.choices).toHaveLength(1);
    const choice = reassembled.choices[0];
    expect(choice?.message.role).toBe("assistant");
    expect(choice?.message.content).toBe("done");
    expect(choice?.finish_reason).toBe("tool_calls");
    expect(choice?.message.tool_calls).toEqual(completion.choices[0]?.message.tool_calls);
    expect(readUsage(reassembled.usage)).toEqual(readUsage(completion.usage));
  });

  test("keeps tool call indices aligned across chunks", () => {
    const events = parseSseStream(serializeCompletionSse(completion));
    const indices = events
      .filter((event) => !event.done)
      .flatMap((event) => {
        const parsed = JSON.parse(event.data) as {
          choices: Array<{ delta: { tool_calls?: Array<{ index: number }> } }>;
        };
        return parsed.choices[0]?.delta.tool_calls ?? [];
      })
      .map((toolCall) => toolCall.index);
    expect(indices).toEqual([0, 0, 1, 1]);
  });

  test("emits a terminal chunk with usage when there is no content", () => {
    const empty: CompletionShape = {
      id: "chatcmpl-2",
      object: "chat.completion",
      created: 2,
      model: "space-bunny-free",
      choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "stop" }],
    };
    const events = parseSseStream(serializeCompletionSse(empty));
    const reassembled = reassembleCompletion(events);
    expect(reassembled.choices[0]?.message.content).toBeNull();
    expect(reassembled.choices[0]?.finish_reason).toBe("stop");
    expect(readUsage(reassembled.usage)).toBeNull();
  });
});

describe("proxy collector scoping", () => {
  test("refuses records without an active run and isolates runs", () => {
    const collector = createProxyCollector();
    expect(collector.activeRunId()).toBeNull();
    expect(collector.record(makeRecord(1))).toBe(false);
    collector.beginRun("run-a");
    expect(collector.activeRunId()).toBe("run-a");
    expect(() => collector.beginRun("run-b")).toThrow(BenchmarkConfigError);
    expect(collector.record(makeRecord(1))).toBe(true);
    const first = collector.endRun("run-a");
    expect(first).toHaveLength(1);
    expect(collector.activeRunId()).toBeNull();
    expect(() => collector.endRun("run-a")).toThrow(BenchmarkConfigError);
    collector.beginRun("run-b");
    expect(collector.record(makeRecord(2), "run-a")).toBe(false);
    expect(collector.record(makeRecord(3), "run-b")).toBe(true);
    expect(collector.endRun("run-b")).toHaveLength(1);
  });
});

describe("template substitution", () => {
  test("replaces every supported placeholder", () => {
    const values = {
      workspace: "C:/w",
      prompt_file: "C:/p.txt",
      model: "space-bunny-free",
      proxy_url: "http://127.0.0.1:1/v1",
    };
    expect(
      substituteTemplate(
        "--ws={workspace} --prompt={prompt_file} --model={model} --proxy={proxy_url}",
        values
      )
    ).toBe("--ws=C:/w --prompt=C:/p.txt --model=space-bunny-free --proxy=http://127.0.0.1:1/v1");
    expect(substituteTemplate("literal {unknown} {workspace}", values)).toBe(
      "literal {unknown} C:/w"
    );
    expect(
      substituteTemplate("{model}", { workspace: "", prompt_file: "", model: "m", proxy_url: "" })
    ).toBe("m");
  });

  test("builds the upstream completions url from a base or full url", () => {
    expect(resolveUpstreamUrl("https://provider.example")).toBe(
      "https://provider.example/v1/chat/completions"
    );
    expect(resolveUpstreamUrl("https://provider.example/")).toBe(
      "https://provider.example/v1/chat/completions"
    );
    expect(resolveUpstreamUrl("https://provider.example/v1/chat/completions")).toBe(
      "https://provider.example/v1/chat/completions"
    );
  });
});

function makeRecord(index: number): {
  index: number;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  status: number;
  success: boolean;
  model: string;
  requested_stream: boolean;
  response_bytes: number;
  usage: TokenUsage | null;
} {
  return {
    index,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:00:00.010Z",
    latency_ms: 10,
    status: 200,
    success: true,
    model: "space-bunny-free",
    requested_stream: false,
    response_bytes: 128,
    usage: null,
  };
}
