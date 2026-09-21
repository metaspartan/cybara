import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import {
  EVIDENCE_RECEIPT_MARKER,
  EVIDENCE_REDUCER_MIN_CHARS,
  type EvidenceReducerInput,
  applyEvidenceReducer,
  getEvidenceReducerStats,
  isEvidenceReducerCandidate,
  reduceExecToolResult,
  resetEvidenceReducerStats,
  verifyEvidenceReceipt,
} from "../../src/core/evidence-reducer";
import type { EvidenceExtractor } from "../../src/core/evidence-reducer";

function hashOf(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function buildSource(lines: number, failureLine?: string): string {
  const rows: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    rows.push(`step ${i}: compiling module ${i} of ${lines} ok`);
  }
  if (failureLine) rows.push(failureLine);
  return rows.join("\n");
}

function receiptJson(input: {
  source: string;
  exitCode: number;
  summary?: string;
  errors?: string[];
  quotes?: string[];
  hashOverride?: string;
  exitOverride?: number;
}): string {
  return JSON.stringify({
    source_sha256: input.hashOverride ?? hashOf(input.source),
    exit_code: input.exitOverride ?? input.exitCode,
    summary: input.summary ?? "Build ran and failed at the linking stage.",
    errors: input.errors ?? ["linker reported duplicate symbol"],
    quotes: input.quotes ?? [],
  });
}

function reducerInput(toolName: string, result: unknown): EvidenceReducerInput {
  return { toolName, args: { command: "bun run build" }, result };
}

describe("isEvidenceReducerCandidate", () => {
  test("accepts exec results above the size threshold", () => {
    const source = buildSource(120);
    expect(source.length).toBeGreaterThan(EVIDENCE_REDUCER_MIN_CHARS);
    expect(isEvidenceReducerCandidate("exec", { output: source, exitCode: 1 })).toBe(true);
  });

  test("rejects non-exec tools, small outputs, and non-object results", () => {
    const source = buildSource(120);
    expect(isEvidenceReducerCandidate("read", { output: source, exitCode: 0 })).toBe(false);
    expect(isEvidenceReducerCandidate("exec", { output: "short", exitCode: 0 })).toBe(false);
    expect(isEvidenceReducerCandidate("exec", { output: source })).toBe(false);
    expect(isEvidenceReducerCandidate("exec", { output: source, exitCode: Number.NaN })).toBe(
      false
    );
    expect(isEvidenceReducerCandidate("exec", "plain string")).toBe(false);
    expect(isEvidenceReducerCandidate("exec", null)).toBe(false);
  });

  test("rejects results already carrying a receipt marker", () => {
    const source = `${buildSource(120)}\n${EVIDENCE_RECEIPT_MARKER}`;
    expect(isEvidenceReducerCandidate("exec", { output: source, exitCode: 0 })).toBe(false);
  });
});

describe("verifyEvidenceReceipt", () => {
  test("accepts a faithful receipt and renders a smaller verified block", () => {
    const failureLine = "error TS2304: Cannot find name 'bunTest' in evidence reducer sample";
    const source = buildSource(120, failureLine);
    const receipt = receiptJson({
      source,
      exitCode: 1,
      quotes: [failureLine],
      errors: ["TS2304"],
    });
    const verified = verifyEvidenceReceipt(receipt, source, 1);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.rendered).toContain(EVIDENCE_RECEIPT_MARKER);
      expect(verified.rendered).toContain(failureLine);
      expect(verified.rendered.length).toBeLessThan(source.length);
    }
  });

  test("accepts fenced JSON receipts", () => {
    const source = buildSource(120);
    const receipt = `\`\`\`json\n${receiptJson({ source, exitCode: 0, quotes: [source.split("\n")[0]] })}\n\`\`\``;
    expect(verifyEvidenceReceipt(receipt, source, 0).ok).toBe(true);
  });

  test("rejects a receipt whose source hash does not match", () => {
    const source = buildSource(120);
    const receipt = receiptJson({ source, exitCode: 0, hashOverride: "deadbeefcafe" });
    const verified = verifyEvidenceReceipt(receipt, source, 0);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("sha256");
  });

  test("rejects a receipt whose exit code differs from the actual exit code", () => {
    const source = buildSource(120);
    const receipt = receiptJson({ source, exitCode: 1, exitOverride: 0 });
    const verified = verifyEvidenceReceipt(receipt, source, 1);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("exit_code");
  });

  test("rejects quotes that are not verbatim in the source", () => {
    const source = buildSource(120);
    const receipt = receiptJson({
      source,
      exitCode: 0,
      quotes: ["this exact line never appeared anywhere in the output"],
    });
    const verified = verifyEvidenceReceipt(receipt, source, 0);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("verbatim");
  });

  test("rejects quotes shorter than the minimum evidence length", () => {
    const source = buildSource(120);
    const receipt = receiptJson({ source, exitCode: 0, quotes: ["step 0:"] });
    const verified = verifyEvidenceReceipt(receipt, source, 0);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("too short");
  });

  test("rejects failed-command receipts without any quoted evidence", () => {
    const source = buildSource(120);
    const receipt = receiptJson({ source, exitCode: 1, quotes: [] });
    const verified = verifyEvidenceReceipt(receipt, source, 1);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("quoted evidence");
  });

  test("rejects malformed JSON and non-object receipts", () => {
    const source = buildSource(120);
    expect(verifyEvidenceReceipt("not json at all", source, 0).ok).toBe(false);
    expect(verifyEvidenceReceipt("[1, 2, 3]", source, 0).ok).toBe(false);
  });

  test("rejects receipts that provide no size reduction", () => {
    const longLine = `error line padded for size gate ${"a".repeat(330)}`;
    const lines: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      lines.push(`${longLine} variant ${i}`);
    }
    const source = lines.join("\n");
    expect(source.length).toBeGreaterThanOrEqual(EVIDENCE_REDUCER_MIN_CHARS);
    const receipt = receiptJson({
      source,
      exitCode: 0,
      summary: "y".repeat(900),
      quotes: lines,
    });
    const verified = verifyEvidenceReceipt(receipt, source, 0);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("size reduction");
  });

  test("rejects receipts with too many quotes", () => {
    const source = buildSource(200);
    const lines = source.split("\n").slice(0, 13);
    const receipt = receiptJson({ source, exitCode: 0, quotes: lines });
    const verified = verifyEvidenceReceipt(receipt, source, 0);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain("item limit");
  });
});

describe("reduceExecToolResult", () => {
  test("replaces large exec output with a verified receipt", async () => {
    resetEvidenceReducerStats();
    const failureLine = "FATAL: EVIDENCE_FAIL_7F3A linker stage returned 42 errors";
    const source = buildSource(150, failureLine);
    const extractor: EvidenceExtractor = async ({ source: src, exitCode, sourceHash }) =>
      receiptJson({
        source: src,
        exitCode,
        quotes: [failureLine],
        hashOverride: sourceHash,
      });
    const original = { output: source, exitCode: 1, cwd: "/tmp" };
    const reduced = await reduceExecToolResult(reducerInput("exec", original), extractor);
    const record = reduced as { output: string; exitCode: number; cwd: string };
    expect(record.output).toContain(EVIDENCE_RECEIPT_MARKER);
    expect(record.output).toContain(failureLine);
    expect(record.output).toContain("Full output archived at:");
    expect(record.output.length).toBeLessThan(source.length);
    expect(record.exitCode).toBe(1);
    expect(record.cwd).toBe("/tmp");
    const statsAfter = getEvidenceReducerStats();
    expect(statsAfter.reduced).toBe(1);
  });

  test("falls back to the original result when the extractor throws", async () => {
    resetEvidenceReducerStats();
    const source = buildSource(150);
    const original = { output: source, exitCode: 0 };
    const failing: EvidenceExtractor = async () => {
      throw new Error("model unavailable");
    };
    const reduced = await reduceExecToolResult(reducerInput("exec", original), failing);
    expect(reduced).toBe(original);
    expect(getEvidenceReducerStats().skipped).toBe(1);
  });

  test("falls back when verification rejects the receipt", async () => {
    resetEvidenceReducerStats();
    const source = buildSource(150);
    const original = { output: source, exitCode: 1 };
    const liar: EvidenceExtractor = async ({ sourceHash }) =>
      receiptJson({
        source,
        exitCode: 1,
        hashOverride: sourceHash,
        quotes: ["fabricated evidence line xyz"],
      });
    const reduced = await reduceExecToolResult(reducerInput("exec", original), liar);
    expect(reduced).toBe(original);
    expect(getEvidenceReducerStats().rejected).toBe(1);
  });

  test("skips sources that appear to contain credentials", async () => {
    resetEvidenceReducerStats();
    const source = `${buildSource(150)}\nusing api_key: sk-abcdefghijklmnopqrstuvwx`;
    const original = { output: source, exitCode: 0 };
    let called = false;
    const extractor: EvidenceExtractor = async () => {
      called = true;
      return "";
    };
    const reduced = await reduceExecToolResult(reducerInput("exec", original), extractor);
    expect(reduced).toBe(original);
    expect(called).toBe(false);
    expect(getEvidenceReducerStats().skipped).toBe(1);
  });

  test("passes through results that are not candidates without calling the extractor", async () => {
    resetEvidenceReducerStats();
    let called = false;
    const extractor: EvidenceExtractor = async () => {
      called = true;
      return "";
    };
    const small = { output: "tiny", exitCode: 0 };
    expect(await reduceExecToolResult(reducerInput("exec", small), extractor)).toBe(small);
    expect(
      await reduceExecToolResult(
        reducerInput("read", { output: buildSource(150), exitCode: 0 }),
        extractor
      )
    ).not.toBe(small);
    expect(called).toBe(false);
    expect(getEvidenceReducerStats().attempts).toBe(0);
  });

  test("archived file referenced by the receipt contains the exact source", async () => {
    resetEvidenceReducerStats();
    const source = buildSource(150);
    const extractor: EvidenceExtractor = async ({ source: src, exitCode, sourceHash }) =>
      receiptJson({
        source: src,
        exitCode,
        quotes: [source.split("\n")[0]],
        hashOverride: sourceHash,
      });
    const reduced = (await reduceExecToolResult(
      {
        toolName: "exec",
        args: {},
        result: { output: source, exitCode: 0 },
        toolContext: { agentId: "test-agent" },
      },
      extractor
    )) as { output: string };
    const match = reduced.output.match(/Full output archived at: (.+)$/m);
    expect(match).not.toBeNull();
    const archivedPath = match?.[1] ?? "";
    const archived = await Bun.file(archivedPath).text();
    expect(archived).toContain("step 0: compiling module 0");
    expect(archived.length).toBeGreaterThanOrEqual(source.length);
  });
});

describe("applyEvidenceReducer", () => {
  test("returns non-candidate results untouched", async () => {
    const small = { output: "tiny", exitCode: 0 };
    expect(await applyEvidenceReducer({ toolName: "exec", args: {}, result: small })).toBe(small);
  });
});
