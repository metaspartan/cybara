import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const METRICS_MODULE = join(ROOT_DIR, "src", "core", "metrics.ts").replace(/\\/g, "/");
const DB_MODULE = join(ROOT_DIR, "src", "core", "database.ts").replace(/\\/g, "/");

// metrics.ts writes to the platform.db resolved from paths.ts (CYBARA_HOME),
// fixed at startup — so the recording + aggregation runs in a child process
// with CYBARA_HOME pointed at a throwaway directory.
const WORKER_SOURCE = `
import * as metrics from "${METRICS_MODULE}";
import { tables } from "${DB_MODULE}";

const out: Record<string, unknown> = {};

// Empty-state: a summary before any data must be all-zero, never NaN/undefined.
const empty = metrics.getMetricsSummary();
out.empty = empty;
out.emptyAllZero = Object.values(empty).every((v) => v === 0);
out.emptyNoNaN = Object.values(empty).every((v) => typeof v === "number" && !Number.isNaN(v));

// getTotal on an unseen type/key is 0, not null/undefined.
out.getTotalUnseen = tables.metrics.getTotal("nope-type", "nope-key");

// Token usage aggregation math.
metrics.trackTokenUsage("gpt-x", "prov-a", 100, 20);
metrics.trackTokenUsage("gpt-x", "prov-a", 50, 30);
out.tokenAll = tables.metrics.getTotal("token_usage", "all"); // (100+20)+(50+30)=200
out.tokenInput = tables.metrics.getTotal("token_usage", "input"); // 150
out.tokenOutput = tables.metrics.getTotal("token_usage", "output"); // 50
out.tokenByModel = tables.metrics.getTotal("token_usage", "gpt-x"); // 120+80=200
out.tokenByProvider = tables.metrics.getTotal("token_usage", "prov-a"); // 200

// Tool call monotonic counters.
metrics.trackToolCall("read", 12, true);
metrics.trackToolCall("read", 8, true);
metrics.trackToolCall("write", 5, false);
// Zero-duration tool call: still recorded as a call, but no duration row.
metrics.trackToolCall("noop", 0, true);
out.toolAll = tables.metrics.getTotal("tool_call", "all"); // 4 (read,read,write,noop)
out.toolRead = tables.metrics.getTotal("tool_call", "read"); // 2
out.toolWrite = tables.metrics.getTotal("tool_call", "write"); // 1
out.toolNoop = tables.metrics.getTotal("tool_call", "noop"); // 1
out.toolReadDuration = tables.metrics.getTotal("tool_duration", "read"); // 12+8=20
out.toolWriteError = tables.metrics.getTotal("tool_error", "write"); // 1
out.toolReadError = tables.metrics.getTotal("tool_error", "read"); // 0 (all succeeded)
out.noopDuration = tables.metrics.getTotal("tool_duration", "noop"); // 0

// API call success/error partition.
metrics.trackApiCall("/a", "GET", 200, 5);
metrics.trackApiCall("/b", "POST", 500, 7);
out.apiSuccess = tables.metrics.getTotal("api_call", "success"); // 1
out.apiError = tables.metrics.getTotal("api_call", "error"); // 1

// Session created events.
metrics.trackSessionEvent("s1", "created");
metrics.trackSessionEvent("s2", "created");
out.sessionsCreated = tables.metrics.getTotal("session_event", "created"); // 2

// Memory flush successes.
metrics.trackMemoryFlush("s1", true);
metrics.trackMemoryFlush("s2", false);
out.memoryFlushSuccess = tables.metrics.getTotal("memory_flush", "success"); // 1

// Context compaction reduction (before-after tokens).
metrics.trackContextCompaction("s1", {
  messagesBefore: 10, messagesAfter: 4, tokensBefore: 1000, tokensAfter: 400,
});
// The reduction is stored under type=context_compaction with key=sessionId,
// and separately under type=compaction_reduction key=tokens.
out.compactionBySession = tables.metrics.getTotal("context_compaction", "s1"); // 600
out.compactionReductionTokens = tables.metrics.getTotal("compaction_reduction", "tokens"); // 600
out.compactionReductionMessages = tables.metrics.getTotal("compaction_reduction", "messages"); // 6
// getMetricsSummary counts compactions via ("compaction_reduction","count"),
// one row per compaction event.
out.compactionReductionCount = tables.metrics.getTotal("compaction_reduction", "count");

// Full summary after recording.
const summary = metrics.getMetricsSummary();
out.summary = summary;
out.summaryNoNaN = Object.values(summary).every((v) => typeof v === "number" && !Number.isNaN(v));

// trackMetric is resilient — a negative/odd value still records numerically.
metrics.trackMetric("custom", "k", -5);
metrics.trackMetric("custom", "k", 15);
out.customTotal = tables.metrics.getTotal("custom", "k"); // 10

console.log("__RESULT__" + JSON.stringify(out));
`;

let tempHome = "";
let r: Record<string, number | Record<string, number> | boolean>;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-metrics-unit-"));
  const cybaraHome = join(tempHome, ".cybara");
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome, CYBARA_HOME: cybaraHome },
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`metrics worker failed: ${proc.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__")) ?? "";
  r = JSON.parse(line.slice("__RESULT__".length));
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("metrics empty state", () => {
  test("getMetricsSummary on an empty DB returns all zeros", () => {
    expect(r.emptyAllZero).toBe(true);
    expect(r.emptyNoNaN).toBe(true);
    expect(r.empty).toEqual({
      totalTokens: 0,
      totalToolCalls: 0,
      totalApiCalls: 0,
      totalSessions: 0,
      memoryFlushes: 0,
      compactions: 0,
    });
  });

  test("getTotal for an unseen type/key is 0, not null", () => {
    expect(r.getTotalUnseen).toBe(0);
  });
});

describe("metrics token usage aggregation", () => {
  test("token totals sum across calls and keys", () => {
    expect(r.tokenAll).toBe(200);
    expect(r.tokenInput).toBe(150);
    expect(r.tokenOutput).toBe(50);
    expect(r.tokenByModel).toBe(200);
    expect(r.tokenByProvider).toBe(200);
  });

  test("input + output equals the total", () => {
    expect((r.tokenInput as number) + (r.tokenOutput as number)).toBe(r.tokenAll as number);
  });
});

describe("metrics tool call counters", () => {
  test("call counters are monotonic and partitioned by key", () => {
    expect(r.toolAll).toBe(4);
    expect(r.toolRead).toBe(2);
    expect(r.toolWrite).toBe(1);
    expect(r.toolNoop).toBe(1);
    expect(
      (r.toolRead as number) + (r.toolWrite as number) + (r.toolNoop as number)
    ).toBe(r.toolAll as number);
  });

  test("duration accumulates and error counter only counts failures", () => {
    expect(r.toolReadDuration).toBe(20);
    expect(r.toolWriteError).toBe(1);
    expect(r.toolReadError).toBe(0);
  });

  test("a zero-duration call records no duration row", () => {
    expect(r.noopDuration).toBe(0);
  });
});

describe("metrics api + session + flush + compaction", () => {
  test("api calls partition into success and error", () => {
    expect(r.apiSuccess).toBe(1);
    expect(r.apiError).toBe(1);
  });

  test("session created events count up", () => {
    expect(r.sessionsCreated).toBe(2);
  });

  test("only successful memory flushes count", () => {
    expect(r.memoryFlushSuccess).toBe(1);
  });

  test("compaction records token reduction under sessionId and reduction keys", () => {
    expect(r.compactionBySession).toBe(600);
    expect(r.compactionReductionTokens).toBe(600);
    expect(r.compactionReductionMessages).toBe(6);
  });

  test("getMetricsSummary counts each compaction event", () => {
    expect(r.compactionReductionCount).toBe(1);
    expect(r.summary.compactions).toBe(1);
  });
});

describe("metrics summary after recording", () => {
  test("summary reflects the recorded totals with no NaN", () => {
    expect(r.summaryNoNaN).toBe(true);
    expect(r.summary).toEqual({
      totalTokens: 200,
      totalToolCalls: 4,
      totalApiCalls: 2,
      totalSessions: 2,
      memoryFlushes: 1,
      compactions: 1,
    });
  });
});

describe("metrics trackMetric arbitrary values", () => {
  test("negative and positive values sum correctly", () => {
    expect(r.customTotal).toBe(10);
  });
});
