import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("metrics performance wiring", () => {
  test("token analysis uses a bounded recent sample instead of scanning raw history", () => {
    const metricsRoute = read("src/api/routes/metrics.ts");

    expect(metricsRoute).toContain("const TOKEN_ANALYSIS_ROW_LIMIT = 6000");
    expect(metricsRoute).toContain('metrics.getByTypeRecent(\n    "token_usage",');
    expect(metricsRoute).toContain("TOKEN_ANALYSIS_ROW_LIMIT");
    expect(metricsRoute).toContain("sampledRows: tokenUsageEntries.length");
    expect(metricsRoute).toContain(
      "truncated: tokenUsageEntries.length >= TOKEN_ANALYSIS_ROW_LIMIT"
    );
    expect(metricsRoute).not.toContain('metrics.getByType("token_usage") as MetricsEntry[];');
  });

  test("session token summaries never scan legacy json metadata on chat load", () => {
    const tracker = read("src/core/llm/token-usage-tracking.ts");
    const sessionContext = read("src/core/session-context.ts");
    const database = read("src/core/database.ts");

    expect(database).toContain(
      "CREATE INDEX IF NOT EXISTS idx_metrics_type_key_created ON metrics(type, key, created_at);"
    );
    expect(tracker).toContain('type: "token_usage_by_session"');
    expect(tracker).toContain("key: tokenMetadata.sessionId");
    expect(sessionContext).toContain("WHERE type = 'token_usage_by_session'");
    expect(sessionContext).toContain("AND key = ?");
    const summaryStart = sessionContext.indexOf("export function summarizeSessionTokenUsage");
    const summaryEnd = sessionContext.indexOf("export function estimateSessionContextUsage");
    const summary = sessionContext.slice(summaryStart, summaryEnd);
    expect(summary).not.toContain("legacySessionTokenUsage");
    expect(summary).not.toContain("json_extract(metadata, '$.sessionId')");
  });
});
