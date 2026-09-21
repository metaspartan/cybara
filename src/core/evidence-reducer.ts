import { createHash } from "crypto";
import { agentManager, type AgentMessage } from "./agent";
import { config } from "./config";
import { redactSecretText } from "./redaction";
import { providerManager } from "./providers";
import type { ToolContext } from "./tools/types";
import { persistToolOutputForRecovery } from "./tool-output-recovery";

export const EVIDENCE_REDUCER_MIN_CHARS = 4096;
export const EVIDENCE_RECEIPT_MARKER = "[Evidence Receipt]";

const REDUCER_TOOL_NAMES = new Set(["exec"]);
const MIN_QUOTE_CHARS = 12;
const MAX_QUOTE_CHARS = 400;
const MAX_QUOTE_COUNT = 12;
const MAX_ERROR_ITEMS = 20;
const MAX_SUMMARY_CHARS = 2000;
const REDUCER_CALL_TIMEOUT_MS = 30_000;

export interface EvidenceReducerStats {
  attempts: number;
  reduced: number;
  rejected: number;
  skipped: number;
}

const stats: EvidenceReducerStats = { attempts: 0, reduced: 0, rejected: 0, skipped: 0 };

export function getEvidenceReducerStats(): EvidenceReducerStats {
  return { ...stats };
}

export function resetEvidenceReducerStats(): void {
  stats.attempts = 0;
  stats.reduced = 0;
  stats.rejected = 0;
  stats.skipped = 0;
}

export interface EvidenceReducerInput {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  toolContext?: ToolContext;
}

export type EvidenceExtractor = (input: {
  source: string;
  exitCode: number;
  sourceHash: string;
}) => Promise<string>;

interface EvidenceReceipt {
  source_sha256: string;
  exit_code: number;
  summary: string;
  errors: string[];
  quotes: string[];
}

export function isEvidenceReducerCandidate(
  toolName: string,
  result: unknown
): result is { output: string; exitCode: number } & Record<string, unknown> {
  if (!REDUCER_TOOL_NAMES.has(toolName)) return false;
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as Record<string, unknown>;
  if (typeof record.output !== "string") return false;
  if (typeof record.exitCode !== "number" || !Number.isFinite(record.exitCode)) return false;
  if (record.output.length < EVIDENCE_REDUCER_MIN_CHARS) return false;
  if (record.output.includes(EVIDENCE_RECEIPT_MARKER)) return false;
  return true;
}

function sourceHashOf(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function effectiveReceiptExitCode(source: string, exitCode: number): number {
  const matches = [...source.matchAll(/EXIT_CODE=(\d+)/g)];
  const last = matches.at(-1);
  if (!last) return exitCode;
  const echoed = Number(last[1]);
  return Number.isFinite(echoed) && echoed !== exitCode ? echoed : exitCode;
}

function hasSuspectedSecrets(source: string): boolean {
  return redactSecretText(source) !== source;
}

function repairShortQuote(quote: string, source: string): string {
  const idx = source.indexOf(quote);
  if (idx === -1) return quote;
  const start = source.lastIndexOf("\n", idx) + 1;
  let end = source.indexOf("\n", idx);
  if (end === -1) end = source.length;
  return source.slice(start, end).trim();
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseReceipt(text: string, source: string, exitCode: number): EvidenceReceipt | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return "receipt is not valid JSON";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "receipt is not a JSON object";
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.source_sha256 !== "string" || record.source_sha256.length === 0) {
    return "receipt missing source_sha256";
  }
  if (record.source_sha256 !== sourceHashOf(source)) {
    return "receipt source_sha256 does not match source";
  }
  if (typeof record.exit_code !== "number" || !Number.isFinite(record.exit_code)) {
    return "receipt missing numeric exit_code";
  }
  if (record.exit_code !== exitCode) {
    return "receipt exit_code does not match actual exit code";
  }
  if (typeof record.summary !== "string" || record.summary.trim().length === 0) {
    return "receipt missing summary";
  }
  if (record.summary.length > MAX_SUMMARY_CHARS) {
    return "receipt summary exceeds size limit";
  }
  if (!isStringArray(record.errors)) {
    return "receipt errors must be an array of strings";
  }
  if (record.errors.length > MAX_ERROR_ITEMS) {
    return "receipt errors exceed item limit";
  }
  if (record.errors.some((item) => item.length > MAX_QUOTE_CHARS)) {
    return "receipt error items exceed size limit";
  }
  if (!isStringArray(record.quotes)) {
    return "receipt quotes must be an array of strings";
  }
  if (record.quotes.length > MAX_QUOTE_COUNT) {
    return "receipt quotes exceed item limit";
  }
  const repairedQuotes: string[] = [];
  for (const rawQuote of record.quotes) {
    let quote = rawQuote.trim();
    if (quote.length < MIN_QUOTE_CHARS) {
      quote = repairShortQuote(quote, source);
    }
    if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) continue;
    if (!source.includes(quote)) continue;
    repairedQuotes.push(quote);
  }
  if (exitCode !== 0 && repairedQuotes.length === 0) {
    return "failed command receipt must include quoted evidence";
  }
  return {
    source_sha256: record.source_sha256,
    exit_code: record.exit_code,
    summary: record.summary.trim(),
    errors: record.errors,
    quotes: repairedQuotes,
  };
}

function renderReceipt(
  receipt: EvidenceReceipt,
  sourceChars: number,
  exitCode: number,
  archivedPath?: string
): string {
  const lines: string[] = [
    `${EVIDENCE_RECEIPT_MARKER} verified: sha256:${receipt.source_sha256} exit_code:${exitCode} source_chars:${sourceChars}`,
    archivedPath
      ? `Full output archived at: ${archivedPath}`
      : "Full output preserved in chat transcript.",
    `Summary: ${receipt.summary}`,
  ];
  if (receipt.errors.length > 0) {
    lines.push("Errors:");
    for (const error of receipt.errors.slice(0, MAX_ERROR_ITEMS)) {
      lines.push(`- ${error.slice(0, MAX_QUOTE_CHARS)}`);
    }
  }
  if (receipt.quotes.length > 0) {
    lines.push("Quoted evidence:");
    for (const quote of receipt.quotes.slice(0, MAX_QUOTE_COUNT)) {
      lines.push(`- ${quote}`);
    }
  }
  return lines.join("\n");
}

export function verifyEvidenceReceipt(
  receiptText: string,
  source: string,
  exitCode: number,
  archivedPath?: string
): { ok: true; rendered: string } | { ok: false; reason: string } {
  const outcome = parseReceipt(receiptText, source, exitCode);
  if (typeof outcome === "string") return { ok: false, reason: outcome };
  const rendered = renderReceipt(outcome, source.length, exitCode, archivedPath);
  if (rendered.length >= source.length) {
    return { ok: false, reason: "receipt provides no size reduction" };
  }
  return { ok: true, rendered };
}

function buildExtractionPrompt(source: string, exitCode: number, sourceHash: string): string {
  return [
    "You reduce command output for a coding agent. Extract only the key evidence from the output below.",
    "Return STRICT JSON only, no prose, no code fences, matching exactly this schema:",
    '{"source_sha256":"<echo the hash>","exit_code":<echo the exit code>,"summary":"<what happened>","errors":["<notable errors/warnings>"],"quotes":["<exact lines copied verbatim from the output>"]}',
    "Rules:",
    `- source_sha256 must be exactly: ${sourceHash}`,
    `- exit_code must be exactly: ${exitCode}`,
    "- Copy every quote character-for-character from the output; never paraphrase, trim, or merge lines.",
    "- Each quote must be one complete line copied verbatim from the output (including prefixes like (pass)/(fail) or error codes). Never quote bare numbers, fragments, or your own wording.",
    "- Quote the most diagnostic lines (failure messages, assertion results, test summaries). At least one quote when the command failed.",
    "- Keep the summary under 120 words. Omit errors array entries when there are none.",
    "",
    "Command output:",
    source,
  ].join("\n");
}

async function callExtractor(
  provider: Parameters<typeof agentManager.callLLM>[0],
  model: string | undefined,
  source: string,
  exitCode: number,
  sourceHash: string
): Promise<string> {
  const messages: AgentMessage[] = [
    { role: "user", content: buildExtractionPrompt(source, exitCode, sourceHash) },
  ];
  const call = agentManager.callLLM(provider, model, messages, []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("reducer call timed out")), REDUCER_CALL_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([call, timeout]);
    return response.content;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function reduceExecToolResult(
  input: EvidenceReducerInput,
  extractor: EvidenceExtractor
): Promise<unknown> {
  if (!isEvidenceReducerCandidate(input.toolName, input.result)) return input.result;
  const source = input.result.output;
  const exitCode = effectiveReceiptExitCode(source, input.result.exitCode);
  if (hasSuspectedSecrets(source)) {
    stats.skipped += 1;
    return input.result;
  }
  stats.attempts += 1;
  const archivedPath = persistToolOutputForRecovery({
    content: source,
    sessionId: input.toolContext?.sessionId,
    toolName: input.toolName,
    toolCallId: input.toolContext?.executionState
      ? `turn-${input.toolContext.executionState.toolCallsStarted}`
      : undefined,
  });
  const sourceHash = sourceHashOf(source);
  let receiptText: string;
  try {
    receiptText = await extractor({ source, exitCode, sourceHash });
  } catch {
    stats.skipped += 1;
    return input.result;
  }
  const verified = verifyEvidenceReceipt(receiptText, source, exitCode, archivedPath);
  if (!verified.ok) {
    stats.rejected += 1;
    return input.result;
  }
  stats.reduced += 1;
  return {
    ...input.result,
    output: verified.rendered,
    exit_code_receipt_reference: exitCode,
  };
}

export async function applyEvidenceReducer(input: EvidenceReducerInput): Promise<unknown> {
  if (!config.getTokenOptimizationSettings().evidenceReducerEnabled) return input.result;
  const providerId = input.toolContext?.activeProviderId?.trim() || "";
  const model = input.toolContext?.activeModel?.trim() || undefined;
  if (!providerId) {
    if (isEvidenceReducerCandidate(input.toolName, input.result)) stats.skipped += 1;
    return input.result;
  }
  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    if (isEvidenceReducerCandidate(input.toolName, input.result)) stats.skipped += 1;
    return input.result;
  }
  return reduceExecToolResult(input, (extractorInput) =>
    callExtractor(
      provider,
      model,
      extractorInput.source,
      extractorInput.exitCode,
      extractorInput.sourceHash
    )
  );
}
