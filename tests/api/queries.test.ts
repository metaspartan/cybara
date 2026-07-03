import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUERIES_PATH = join(ROOT_DIR, "src", "api", "queries.ts").replace(/\\/g, "/");
const DB_PATH = join(ROOT_DIR, "src", "core", "database.ts").replace(/\\/g, "/");

// queries.ts imports the live DB from database.ts, which initializes a SQLite
// file under CYBARA_HOME at module load. The scenarios therefore run in a child
// process with HOME/CYBARA_HOME pointed at a throwaway directory; rows are
// seeded through the tables API before the query functions are exercised. Pure
// helpers (normalizeTimestamp) run in the same worker so no live DB leaks into
// the test process.
const WORKER_SOURCE = `
import {
  normalizeTimestamp,
  getCombinedLogs,
  getCombinedLogTotal,
  getCombinedLogsPage,
  getCliLogs,
  getLogStats,
  getDailyLogCounts,
  getModelMetrics,
} from "${QUERIES_PATH}";
import { tables } from "${DB_PATH}";
import { writeFileSync } from "fs";
import { join } from "path";

let seq = 0;
function id(prefix) {
  seq += 1;
  return prefix + "-" + seq;
}

// Timestamps in the "YYYY-MM-DD HH:MM:SS" SQLite form. Older first.
function seedLogs() {
  const now = Date.now();
  // system logs: 3 rows
  tables.systemLogs.add({ id: id("sys"), level: "error", source: "boot", message: "sys older" });
  tables.systemLogs.add({ id: id("sys"), level: "info", source: "boot", message: "sys newer" });
  tables.systemLogs.add({ id: id("sys"), level: "info", source: "boot", message: "sys newest" });
  // agent logs: 2 rows
  tables.agentLogs.add({ id: id("agt"), agent_id: "abcdef0123456789", action: "start", details: "go" });
  tables.agentLogs.add({ id: id("agt"), agent_id: "abcdef0123456789", action: "stop" });
  // channel logs: 2 rows, one with long content to exercise truncation
  tables.channelLogs.add({
    id: id("chn"),
    channel_type: "slack",
    channel_id: "C1",
    direction: "inbound",
    sender_id: "U1",
    content: "x".repeat(150),
  });
  tables.channelLogs.add({
    id: id("chn"),
    channel_type: "slack",
    direction: "outbound",
    content: "short",
  });
  return now;
}

const results = {};

results.normalizeTimestamp = {
  undefined: normalizeTimestamp(undefined),
  empty: normalizeTimestamp(""),
  sqlite: normalizeTimestamp("2024-01-02 10:30:00"),
  alreadyZ: normalizeTimestamp("2024-01-02T10:30:00Z"),
  withPlus: normalizeTimestamp("2024-01-02T10:30:00+02:00"),
  withOffsetMinus: normalizeTimestamp("2024-01-02T10:30:00-05:00"),
};

// Empty DB behaviour first.
results.combinedEmpty = getCombinedLogs();
results.combinedEmptyPaged = getCombinedLogsPage({ limit: 10 });
results.totalEmpty = getCombinedLogTotal();
results.statsEmpty = getLogStats(24);
results.metricsEmpty = getModelMetrics();
results.statsZeroHours = getLogStats(0);

seedLogs();

results.total = getCombinedLogTotal();
const all = getCombinedLogs();
results.allCount = all.length;
results.allSortedDesc = all.every((l, i) => i === 0 || new Date(all[i - 1].created_at).getTime() >= new Date(l.created_at).getTime());
results.allTypes = all.map((l) => l.logType).sort();
results.allHaveZ = all.every((l) => l.created_at.endsWith("Z"));
results.agentMessage = all.find((l) => l.logType === "agent" && l.message.includes("start"))?.message ?? null;
results.channelTruncated = all.find((l) => l.logType === "channel" && l.message.includes("..."))?.message ?? null;
results.channelShort = all.find((l) => l.logType === "channel" && l.message.includes("short"))?.message ?? null;

results.pageOffset0 = getCombinedLogs({ limit: 3, offset: 0 }).map((l) => l.id);
results.pageOffset3 = getCombinedLogs({ limit: 3, offset: 3 }).map((l) => l.id);
results.pageOffset6 = getCombinedLogs({ limit: 3, offset: 6 }).map((l) => l.id);
results.pageBigOffset = getCombinedLogs({ limit: 3, offset: 999 });
results.pageZeroLimit = getCombinedLogs({ limit: 0 });
results.pageNegOffset = getCombinedLogs({ limit: 2, offset: -5 }).map((l) => l.id);
results.pageOnlyOffset = getCombinedLogs({ offset: 2 }).map((l) => l.id);
results.pageNoOpts = getCombinedLogs().map((l) => l.id);

const p = getCombinedLogsPage({ limit: 3, offset: 0 });
results.pageFirst = { count: p.logs.length, total: p.total, limit: p.limit, offset: p.offset, hasMore: p.hasMore };
const pLast = getCombinedLogsPage({ limit: 3, offset: 6 });
results.pageLast = { count: pLast.logs.length, total: pLast.total, hasMore: pLast.hasMore };
const pOver = getCombinedLogsPage({ limit: 5, offset: 100 });
results.pageOver = { count: pOver.logs.length, hasMore: pOver.hasMore };
const pClampLimit = getCombinedLogsPage({ limit: 100000 });
results.pageClampLimit = pClampLimit.limit;
const pClampMin = getCombinedLogsPage({ limit: 0 });
results.pageClampMin = pClampMin.limit;

results.stats = getLogStats(24);

// Model metrics: seed metrics rows for TPS, latency, tokens.
tables.metrics.add({ id: id("m"), type: "model_tps", key: "gpt", value: 10, metadata: JSON.stringify({ provider: "openai" }) });
tables.metrics.add({ id: id("m"), type: "model_tps", key: "gpt", value: 20 });
tables.metrics.add({ id: id("m"), type: "model_tps", key: "gpt", value: 30, metadata: JSON.stringify({ provider: "openai" }) });
tables.metrics.add({ id: id("m"), type: "model_tps", key: "solo", value: 5, metadata: JSON.stringify({ provider: "x" }) });
tables.metrics.add({ id: id("m"), type: "model_latency", key: "gpt", value: 100 });
tables.metrics.add({ id: id("m"), type: "model_latency", key: "gpt", value: 300 });
tables.metrics.add({ id: id("m"), type: "token_usage_by_model", key: "gpt", value: 111 });
tables.metrics.add({ id: id("m"), type: "token_usage_by_model", key: "gpt", value: 222 });

results.metrics = getModelMetrics();

// CLI log file parsing: JSON lines, "[ISO] message" daemon lines, and plain
// stdout lines that inherit the timestamp of the line above them.
writeFileSync(
  join(process.env.CYBARA_HOME, "cybara.log"),
  [
    '{"timestamp":"2026-01-02T10:00:00.000Z","level":"error","module":"ChannelManager","message":"adapter crashed","context":{"type":"slack"}}',
    "[2026-01-02T10:00:01.000Z] Daemon child process starting...",
    "[API] GET /api/health 200 2ms",
    "[Discord] Failed to connect",
    "",
  ].join("\\n"),
  "utf-8"
);
const cliEntries = getCliLogs();
results.cliCount = cliEntries.length;
results.cliMessages = cliEntries.map((l) => l.message);
results.cliLevels = cliEntries.map((l) => l.level);
results.cliSources = [...new Set(cliEntries.map((l) => l.source))];
results.cliTimestamps = cliEntries.map((l) => l.created_at);
results.cliMetadata = cliEntries.find((l) => l.metadata)?.metadata ?? null;
results.statsWithCli = getLogStats(24).counts.cli;
results.totalWithCli = getCombinedLogTotal();
results.combinedIncludesCli = getCombinedLogs().some((l) => l.logType === "cli");

console.log("###RESULT###" + JSON.stringify(results));
`;

let out: Record<string, unknown> = {};
let tempHome = "";

function r<T>(key: string): T {
  if (!(key in out)) throw new Error("missing result " + key);
  return out[key] as T;
}

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-queries-home-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`worker failed: ${proc.stderr.toString()}\n${stdout}`);
  }
  const marker = stdout.split("###RESULT###").at(-1) ?? "";
  out = JSON.parse(marker.trim()) as Record<string, unknown>;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("normalizeTimestamp", () => {
  test("passes through undefined and empty unchanged", () => {
    const ts = r<Record<string, string | undefined>>("normalizeTimestamp");
    expect(ts.undefined).toBeUndefined();
    expect(ts.empty).toBe("");
  });

  test("converts SQLite space-separated timestamps to ISO with a Z suffix", () => {
    const ts = r<Record<string, string>>("normalizeTimestamp");
    expect(ts.sqlite).toBe("2024-01-02T10:30:00Z");
  });

  test("leaves timestamps that already carry timezone info alone", () => {
    const ts = r<Record<string, string>>("normalizeTimestamp");
    expect(ts.alreadyZ).toBe("2024-01-02T10:30:00Z");
    expect(ts.withPlus).toBe("2024-01-02T10:30:00+02:00");
    expect(ts.withOffsetMinus).toBe("2024-01-02T10:30:00-05:00");
  });
});

describe("getCombinedLogs on an empty database", () => {
  test("returns no logs and a zero total", () => {
    expect(r("combinedEmpty")).toEqual([]);
    expect(r("totalEmpty")).toBe(0);
  });

  test("paged query returns an empty page with hasMore false", () => {
    const p = r<{ logs: unknown[]; total: number; hasMore: boolean }>("combinedEmptyPaged");
    expect(p.logs).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.hasMore).toBe(false);
  });
});

describe("getCliLogs", () => {
  test("parses JSON, daemon, and plain lines newest-first with source cli", () => {
    expect(r("cliCount")).toBe(4);
    expect(r<string[]>("cliSources")).toEqual(["cli"]);
    expect(r<string[]>("cliMessages")).toEqual([
      "[Discord] Failed to connect",
      "[API] GET /api/health 200 2ms",
      "Daemon child process starting...",
      "[ChannelManager] adapter crashed",
    ]);
  });

  test("infers levels: JSON level wins, plain lines match error/warn keywords", () => {
    expect(r<string[]>("cliLevels")).toEqual(["error", "info", "info", "error"]);
  });

  test("plain lines inherit the timestamp of the preceding stamped line", () => {
    const timestamps = r<string[]>("cliTimestamps");
    expect(timestamps[0]).toBe("2026-01-02T10:00:01.000Z");
    expect(timestamps[1]).toBe("2026-01-02T10:00:01.000Z");
    expect(timestamps[3]).toBe("2026-01-02T10:00:00.000Z");
  });

  test("JSON context becomes metadata", () => {
    expect(r("cliMetadata")).toBe('{"type":"slack"}');
  });

  test("cli entries join combined logs and totals; stats window still applies", () => {
    expect(r("combinedIncludesCli")).toBe(true);
    expect(r("totalWithCli")).toBe(11);
    // Fixture timestamps are far outside the 24h stats window.
    expect(r("statsWithCli")).toBe(0);
  });
});

describe("getLogStats", () => {
  test("empty database yields zero counts (no divide-by-zero, no NaN)", () => {
    const s = r<{ counts: Record<string, number>; hours: number }>("statsEmpty");
    expect(s.counts).toEqual({ system: 0, messages: 0, agent: 0, channel: 0, cli: 0 });
    expect(s.hours).toBe(24);
    for (const v of Object.values(s.counts)) expect(Number.isNaN(v)).toBe(false);
  });

  test("hours=0 window yields zero counts and echoes hours", () => {
    const s = r<{ counts: Record<string, number>; hours: number }>("statsZeroHours");
    expect(s.hours).toBe(0);
    expect(s.counts).toEqual({ system: 0, messages: 0, agent: 0, channel: 0, cli: 0 });
  });

  test("counts freshly seeded rows within a 24h window", () => {
    const s = r<{ counts: Record<string, number> }>("stats");
    expect(s.counts.system).toBe(3);
    expect(s.counts.agent).toBe(2);
    expect(s.counts.channel).toBe(2);
    expect(s.counts.messages).toBe(0);
  });
});

describe("getCombinedLogs combining + formatting", () => {
  test("combines all three log sources with normalized Z timestamps", () => {
    expect(r("allCount")).toBe(7);
    expect(r("total")).toBe(7);
    expect(r("allHaveZ")).toBe(true);
    expect(r<string[]>("allTypes")).toEqual([
      "agent",
      "agent",
      "channel",
      "channel",
      "system",
      "system",
      "system",
    ]);
  });

  test("sorts combined logs by created_at descending", () => {
    expect(r("allSortedDesc")).toBe(true);
  });

  test("formats agent messages with a truncated agent id", () => {
    const msg = r<string>("agentMessage");
    expect(msg).toContain("Agent abcdef01...");
    expect(msg).toContain("start");
    expect(msg).toContain(": go");
  });

  test("truncates channel content over 100 chars with an ellipsis", () => {
    const msg = r<string>("channelTruncated");
    expect(msg).toContain("inbound slack");
    expect(msg).toContain("from U1");
    expect(msg.endsWith("...")).toBe(true);
  });

  test("leaves short channel content without an ellipsis", () => {
    const msg = r<string>("channelShort");
    expect(msg).toContain("outbound slack");
    expect(msg).toContain(": short");
    expect(msg.endsWith("...")).toBe(false);
  });
});

describe("getCombinedLogs paging (post-combine slicing)", () => {
  test("consecutive pages partition the full ordered set without overlap", () => {
    const p0 = r<string[]>("pageOffset0");
    const p1 = r<string[]>("pageOffset3");
    const p2 = r<string[]>("pageOffset6");
    expect(p0.length).toBe(3);
    expect(p1.length).toBe(3);
    expect(p2.length).toBe(1);
    const all = r<string[]>("pageNoOpts");
    expect([...p0, ...p1, ...p2]).toEqual(all);
    expect(new Set([...p0, ...p1, ...p2]).size).toBe(7);
  });

  test("offset beyond the end returns an empty array", () => {
    expect(r("pageBigOffset")).toEqual([]);
  });

  test("limit of zero returns an empty array", () => {
    expect(r("pageZeroLimit")).toEqual([]);
  });

  test("negative offset is clamped to zero", () => {
    const negOffset = r<string[]>("pageNegOffset");
    const all = r<string[]>("pageNoOpts");
    expect(negOffset).toEqual(all.slice(0, 2));
  });

  test("offset with no limit returns the tail from the offset", () => {
    const onlyOffset = r<string[]>("pageOnlyOffset");
    const all = r<string[]>("pageNoOpts");
    expect(onlyOffset).toEqual(all.slice(2));
  });
});

describe("getCombinedLogsPage (DB-window paging)", () => {
  test("first page reports correct total and hasMore", () => {
    const p = r<{ count: number; total: number; limit: number; offset: number; hasMore: boolean }>(
      "pageFirst"
    );
    expect(p.count).toBe(3);
    expect(p.total).toBe(7);
    expect(p.limit).toBe(3);
    expect(p.offset).toBe(0);
    expect(p.hasMore).toBe(true);
  });

  test("last partial page reports hasMore false", () => {
    const p = r<{ count: number; total: number; hasMore: boolean }>("pageLast");
    expect(p.count).toBe(1);
    expect(p.total).toBe(7);
    expect(p.hasMore).toBe(false);
  });

  test("offset past the end returns no rows and hasMore false", () => {
    const p = r<{ count: number; hasMore: boolean }>("pageOver");
    expect(p.count).toBe(0);
    expect(p.hasMore).toBe(false);
  });

  test("limit is clamped to the [1, 1000] range", () => {
    expect(r("pageClampLimit")).toBe(1000);
    expect(r("pageClampMin")).toBe(1);
  });
});

describe("getModelMetrics aggregation", () => {
  test("empty database returns no model metrics", () => {
    expect(r("metricsEmpty")).toEqual([]);
  });

  test("aggregates TPS/latency/tokens per model with rounding and defaults", () => {
    const metrics = r<
      Array<{
        model: string;
        provider: string;
        avgTps: number;
        maxTps: number;
        minTps: number;
        avgLatencyMs: number;
        totalTokens: number;
        callCount: number;
      }>
    >("metrics");
    const gpt = metrics.find((m) => m.model === "gpt")!;
    expect(gpt.provider).toBe("openai");
    expect(gpt.avgTps).toBe(20);
    expect(gpt.maxTps).toBe(30);
    expect(gpt.minTps).toBe(10);
    expect(gpt.callCount).toBe(3);
    expect(gpt.avgLatencyMs).toBe(200);
    expect(gpt.totalTokens).toBe(333);
  });

  test("defaults provider to unknown, latency to 0, and tokens to 0 when unmatched", () => {
    const metrics =
      r<Array<{ model: string; provider: string; avgLatencyMs: number; totalTokens: number }>>(
        "metrics"
      );
    const solo = metrics.find((m) => m.model === "solo")!;
    expect(solo.provider).toBe("x");
    expect(solo.avgLatencyMs).toBe(0);
    expect(solo.totalTokens).toBe(0);
  });
});
