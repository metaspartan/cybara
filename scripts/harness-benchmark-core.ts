import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export class BenchmarkConfigError extends Error {}

export type HarnessKind = "command" | "gateway";
export type AssertionKind = "file_json" | "file_text";
export type RunStatus = "ok" | "error" | "timeout";

export interface TaskFile {
  path: string;
  content: string;
}

export interface FileJsonAssertion {
  kind: "file_json";
  path: string;
  expected: unknown;
}

export interface FileTextAssertion {
  kind: "file_text";
  path: string;
  expected: string;
}

export type TaskAssertion = FileJsonAssertion | FileTextAssertion;

export interface BenchmarkTask {
  id: string;
  prompt: string;
  files: TaskFile[];
  assertions: TaskAssertion[];
}

export interface CommandHarnessSpec {
  id: string;
  kind: "command";
  command: string[];
  env: Record<string, string>;
  cwd_mode: "workspace";
  timeout_ms: number;
}

export interface GatewayHarnessSpec {
  id: string;
  kind: "gateway";
  url: string;
  api_key_env: string;
  agent_id: string;
  timeout_ms: number;
}

export type HarnessSpec = CommandHarnessSpec | GatewayHarnessSpec;

export interface BenchmarkConfig {
  output_dir: string;
  model: string;
  provider_url: string;
  provider_key_env: string;
  rounds: number;
  tasks: BenchmarkTask[];
  harnesses: HarnessSpec[];
}

export const BENCHMARK_LIMITS = {
  config_bytes: 2 * 1024 * 1024,
  tasks: 20,
  harnesses: 10,
  rounds: 50,
  runs: 60,
  prompt_chars: 64 * 1024,
  file_content_bytes: 256 * 1024,
  file_bytes_per_task: 32,
  assertions_per_task: 32,
  command_args: 64,
  arg_chars: 4096,
  path_chars: 512,
  path_segments: 32,
  min_timeout_ms: 1000,
  max_timeout_ms: 3_600_000,
  name_chars: 64,
} as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new BenchmarkConfigError(message);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.length === 0) fail(`${label} must not be empty`);
  if (value.length > maxChars) fail(`${label} exceeds ${maxChars} characters`);
  return value;
}

function requireId(value: unknown, label: string): string {
  const text = requireString(value, label, BENCHMARK_LIMITS.name_chars);
  if (!ID_PATTERN.test(text)) fail(`${label} must match ${ID_PATTERN.source}`);
  return text;
}

function requireEnvName(value: unknown, label: string): string {
  const text = requireString(value, label, BENCHMARK_LIMITS.name_chars);
  if (!ENV_NAME_PATTERN.test(text)) fail(`${label} must match ${ENV_NAME_PATTERN.source}`);
  return text;
}

function requireTimeout(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a number`);
  if (value < BENCHMARK_LIMITS.min_timeout_ms || value > BENCHMARK_LIMITS.max_timeout_ms) {
    fail(
      `${label} must be between ${BENCHMARK_LIMITS.min_timeout_ms} and ${BENCHMARK_LIMITS.max_timeout_ms}`
    );
  }
  return Math.floor(value);
}

function requireHttpUrl(value: unknown, label: string): string {
  const text = requireString(value, label, 2048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return fail(`${label} must be an absolute url`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`${label} must use http or https`);
  }
  return text;
}

export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > BENCHMARK_LIMITS.path_chars) return false;
  if (value.includes("\0") || value.includes("\\") || value.includes("~")) return false;
  if (value.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  if (segments.length > BENCHMARK_LIMITS.path_segments) return false;
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > 128) return false;
    if (segment === "." || segment === "..") return false;
  }
  return true;
}

function requireSafePath(value: unknown, label: string): string {
  const text = requireString(value, label, BENCHMARK_LIMITS.path_chars);
  if (!isSafeRelativePath(text)) fail(`${label} must be a confined relative path`);
  return text;
}

function realpathNearest(target: string): string {
  let current = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

export function isInsideRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export function resolveWithinRoot(root: string, relative: string): string | null {
  if (!isSafeRelativePath(relative)) return null;
  const rootReal = realpathNearest(root);
  if (!existsSync(rootReal)) return null;
  const target = resolve(rootReal, relative);
  if (!isInsideRoot(rootReal, target)) return null;
  if (existsSync(target)) {
    const resolved = strictRealpath(target);
    if (resolved === null) return null;
    return isInsideRoot(rootReal, resolved) ? resolved : null;
  }
  const parent = strictRealpath(dirname(target));
  if (parent === null) return null;
  return isInsideRoot(rootReal, parent) ? target : null;
}

function strictRealpath(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

function parseTaskFile(value: unknown, label: string): TaskFile {
  const raw = requireObject(value, label);
  const content =
    typeof raw.content === "string" ? raw.content : fail(`${label}.content must be a string`);
  if (Buffer.byteLength(content, "utf8") > BENCHMARK_LIMITS.file_content_bytes) {
    fail(`${label}.content exceeds ${BENCHMARK_LIMITS.file_content_bytes} bytes`);
  }
  return { path: requireSafePath(raw.path, `${label}.path`), content };
}

function parseAssertion(value: unknown, label: string): TaskAssertion {
  const raw = requireObject(value, label);
  const kind = requireString(raw.kind, `${label}.kind`, 32);
  const path = requireSafePath(raw.path, `${label}.path`);
  if (kind === "file_text") {
    return {
      kind,
      path,
      expected: requireString(raw.expected, `${label}.expected`, BENCHMARK_LIMITS.prompt_chars),
    };
  }
  if (kind === "file_json") {
    if (!("expected" in raw)) fail(`${label}.expected is required`);
    return { kind, path, expected: raw.expected };
  }
  return fail(`${label}.kind must be file_json or file_text`);
}

function parseTask(value: unknown, index: number): BenchmarkTask {
  const label = `tasks[${index}]`;
  const raw = requireObject(value, label);
  const prompt = requireString(raw.prompt, `${label}.prompt`, BENCHMARK_LIMITS.prompt_chars);
  const fileValues = raw.files === undefined ? [] : requireArray(raw.files, `${label}.files`);
  const assertionValues =
    raw.assertions === undefined ? [] : requireArray(raw.assertions, `${label}.assertions`);
  if (fileValues.length > BENCHMARK_LIMITS.file_bytes_per_task) {
    fail(`${label}.files exceeds ${BENCHMARK_LIMITS.file_bytes_per_task} entries`);
  }
  if (assertionValues.length === 0) fail(`${label}.assertions must not be empty`);
  if (assertionValues.length > BENCHMARK_LIMITS.assertions_per_task) {
    fail(`${label}.assertions exceeds ${BENCHMARK_LIMITS.assertions_per_task} entries`);
  }
  return {
    id: requireId(raw.id, `${label}.id`),
    prompt,
    files: fileValues.map((entry, fileIndex) =>
      parseTaskFile(entry, `${label}.files[${fileIndex}]`)
    ),
    assertions: assertionValues.map((entry, assertionIndex) =>
      parseAssertion(entry, `${label}.assertions[${assertionIndex}]`)
    ),
  };
}

function parseHarness(value: unknown, index: number): HarnessSpec {
  const label = `harnesses[${index}]`;
  const raw = requireObject(value, label);
  const id = requireId(raw.id, `${label}.id`);
  const kind = requireString(raw.kind, `${label}.kind`, 32);
  if (kind === "command") {
    const commandValues = requireArray(raw.command, `${label}.command`);
    if (commandValues.length === 0) fail(`${label}.command must not be empty`);
    if (commandValues.length > BENCHMARK_LIMITS.command_args) {
      fail(`${label}.command exceeds ${BENCHMARK_LIMITS.command_args} arguments`);
    }
    const command = commandValues.map((entry, commandIndex) =>
      requireString(entry, `${label}.command[${commandIndex}]`, BENCHMARK_LIMITS.arg_chars)
    );
    const env: Record<string, string> = {};
    if (raw.env !== undefined) {
      const envRaw = requireObject(raw.env, `${label}.env`);
      for (const [key, value] of Object.entries(envRaw)) {
        if (!ENV_NAME_PATTERN.test(key))
          fail(`${label}.env.${key} must match ${ENV_NAME_PATTERN.source}`);
        env[key] = requireString(value, `${label}.env.${key}`, BENCHMARK_LIMITS.arg_chars);
      }
    }
    const cwdMode =
      raw.cwd_mode === undefined
        ? "workspace"
        : requireString(raw.cwd_mode, `${label}.cwd_mode`, 32);
    if (cwdMode !== "workspace") fail(`${label}.cwd_mode must be workspace`);
    return {
      id,
      kind,
      command,
      env,
      cwd_mode: "workspace",
      timeout_ms: requireTimeout(raw.timeout_ms, `${label}.timeout_ms`, 600_000),
    };
  }
  if (kind === "gateway") {
    return {
      id,
      kind,
      url: requireHttpUrl(raw.url, `${label}.url`),
      api_key_env: requireEnvName(raw.api_key_env, `${label}.api_key_env`),
      agent_id: requireString(raw.agent_id, `${label}.agent_id`, BENCHMARK_LIMITS.name_chars),
      timeout_ms: requireTimeout(raw.timeout_ms, `${label}.timeout_ms`, 600_000),
    };
  }
  return fail(`${label}.kind must be command or gateway`);
}

export function parseBenchmarkConfig(value: unknown): BenchmarkConfig {
  const raw = requireObject(value, "config");
  const tasks = requireArray(raw.tasks, "tasks").map(parseTask);
  const harnesses = requireArray(raw.harnesses, "harnesses").map(parseHarness);
  if (tasks.length === 0) fail("tasks must not be empty");
  if (harnesses.length === 0) fail("harnesses must not be empty");
  if (tasks.length > BENCHMARK_LIMITS.tasks) fail(`tasks exceeds ${BENCHMARK_LIMITS.tasks}`);
  if (harnesses.length > BENCHMARK_LIMITS.harnesses)
    fail(`harnesses exceeds ${BENCHMARK_LIMITS.harnesses}`);
  assertUniqueIds(
    tasks.map((task) => task.id),
    "task"
  );
  assertUniqueIds(
    harnesses.map((harness) => harness.id),
    "harness"
  );
  const rounds = raw.rounds === undefined ? 1 : raw.rounds;
  if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1)
    fail("rounds must be a positive integer");
  if (rounds > BENCHMARK_LIMITS.rounds) fail(`rounds exceeds ${BENCHMARK_LIMITS.rounds}`);
  const totalRuns = rounds * tasks.length * harnesses.length;
  if (totalRuns > BENCHMARK_LIMITS.runs) {
    fail(`plan of ${totalRuns} runs exceeds the ${BENCHMARK_LIMITS.runs} run budget`);
  }
  return {
    output_dir: requireString(raw.output_dir, "output_dir", BENCHMARK_LIMITS.path_chars),
    model: requireString(raw.model, "model", 200),
    provider_url: requireHttpUrl(raw.provider_url, "provider_url"),
    provider_key_env: requireEnvName(raw.provider_key_env, "provider_key_env"),
    rounds,
    tasks,
    harnesses,
  };
}

export function assertUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`duplicate ${label} id ${id}`);
    seen.add(id);
  }
}

export function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) return [];
  const shift = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

export interface PlannedRun {
  run_id: string;
  round: number;
  sequence: number;
  task_id: string;
  harness_id: string;
  harness_kind: HarnessKind;
}

export function buildRunPlan(config: BenchmarkConfig, seed = 0): PlannedRun[] {
  const plan: PlannedRun[] = [];
  for (let round = 0; round < config.rounds; round += 1) {
    const tasks = rotate(config.tasks, seed + round);
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex];
      if (!task) continue;
      const offset = seed + round * config.tasks.length + taskIndex;
      for (const harness of rotate(config.harnesses, offset)) {
        plan.push({
          run_id: `r${round + 1}-${task.id}-${harness.id}`,
          round: round + 1,
          sequence: plan.length,
          task_id: task.id,
          harness_id: harness.id,
          harness_kind: harness.kind,
        });
      }
    }
  }
  return plan;
}

export function deepEqualsJson(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqualsJson(item, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
    return leftKeys.every((key) => deepEqualsJson(leftRecord[key], rightRecord[key]));
  }
  return left === right;
}

export function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .replace(/\n+$/, "");
}

export interface AssertionResult {
  kind: AssertionKind;
  path: string;
  passed: boolean;
  reason: "ok" | "missing" | "unsafe_path" | "read_error" | "invalid_json" | "mismatch";
}

function readConfinedFile(
  fixtureDir: string,
  path: string
): { text: string } | { error: AssertionResult["reason"] } {
  const target = resolveWithinRoot(fixtureDir, path);
  if (target === null) return { error: "unsafe_path" };
  if (!existsSync(target)) return { error: "missing" };
  try {
    return { text: readFileSync(target, "utf8") };
  } catch {
    return { error: "read_error" };
  }
}

export function scoreAssertions(
  fixtureDir: string,
  assertions: readonly TaskAssertion[]
): AssertionResult[] {
  return assertions.map((assertion) => {
    const read = readConfinedFile(fixtureDir, assertion.path);
    if ("error" in read) {
      return { kind: assertion.kind, path: assertion.path, passed: false, reason: read.error };
    }
    if (assertion.kind === "file_text") {
      const passed = normalizeText(read.text) === normalizeText(assertion.expected);
      return {
        kind: assertion.kind,
        path: assertion.path,
        passed,
        reason: passed ? "ok" : "mismatch",
      };
    }
    let actual: unknown;
    try {
      actual = JSON.parse(read.text);
    } catch {
      return { kind: assertion.kind, path: assertion.path, passed: false, reason: "invalid_json" };
    }
    const passed = deepEqualsJson(actual, assertion.expected);
    return {
      kind: assertion.kind,
      path: assertion.path,
      passed,
      reason: passed ? "ok" : "mismatch",
    };
  });
}

export const USAGE_FIELDS = [
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
] as const;

export type UsageField = (typeof USAGE_FIELDS)[number];

export type TokenUsage = { [Field in UsageField]: number | null };

export interface UsageAggregate extends TokenUsage {
  requests: number;
  requests_with_usage: number;
  complete: boolean;
}

export function emptyUsage(): TokenUsage {
  return {
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    prompt_cache_hit_tokens: null,
    prompt_cache_miss_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
  };
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readNested(source: Record<string, unknown>, key: string, field: string): number | null {
  const nested = source[key];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return null;
  return readNumber(nested as Record<string, unknown>, field);
}

function firstNumber(...values: Array<number | null>): number | null {
  for (const value of values) {
    if (value !== null) return value;
  }
  return null;
}

export function readUsage(raw: unknown): TokenUsage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const prompt = firstNumber(
    readNumber(source, "prompt_tokens"),
    readNumber(source, "input_tokens")
  );
  const completion = firstNumber(
    readNumber(source, "completion_tokens"),
    readNumber(source, "output_tokens")
  );
  const reportedTotal = readNumber(source, "total_tokens");
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens:
      reportedTotal ?? (prompt !== null && completion !== null ? prompt + completion : null),
    prompt_cache_hit_tokens: firstNumber(
      readNested(source, "prompt_tokens_details", "cached_tokens"),
      readNested(source, "input_tokens_details", "cached_tokens"),
      readNumber(source, "cache_read_input_tokens")
    ),
    prompt_cache_miss_tokens: firstNumber(
      readNested(source, "prompt_tokens_details", "cache_miss_tokens")
    ),
    cache_read_tokens: firstNumber(
      readNumber(source, "cache_read_tokens"),
      readNested(source, "prompt_tokens_details", "cached_tokens"),
      readNested(source, "input_tokens_details", "cached_tokens"),
      readNumber(source, "cache_read_input_tokens")
    ),
    cache_write_tokens: firstNumber(
      readNumber(source, "cache_creation_input_tokens"),
      readNumber(source, "cache_write_tokens")
    ),
    reasoning_tokens: firstNumber(
      readNested(source, "completion_tokens_details", "reasoning_tokens"),
      readNested(source, "output_tokens_details", "reasoning_tokens")
    ),
  };
}

function hasReportedUsage(usage: TokenUsage | null): boolean {
  if (usage === null) return false;
  return USAGE_FIELDS.some((field) => usage[field] !== null);
}

export function sumUsages(samples: ReadonlyArray<TokenUsage | null>): UsageAggregate {
  const aggregate = emptyUsage() as UsageAggregate;
  const withUsage = samples.filter(hasReportedUsage);
  aggregate.requests = samples.length;
  aggregate.requests_with_usage = withUsage.length;
  aggregate.complete = withUsage.length === samples.length && withUsage.length > 0;
  if (withUsage.length === 0) return aggregate;
  for (const field of USAGE_FIELDS) {
    let total = 0;
    let complete = withUsage.length === samples.length;
    for (const usage of withUsage) {
      const value = usage?.[field] ?? null;
      if (value === null) {
        complete = false;
        continue;
      }
      total += value;
    }
    aggregate[field] = complete ? total : null;
  }
  return aggregate;
}

export interface ProxyRequestRecord {
  index: number;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  upstream_ms?: number | null;
  status: number;
  success: boolean;
  model: string;
  requested_stream: boolean;
  request_bytes?: number;
  tools_count?: number;
  messages_count?: number;
  system_chars?: number;
  tool_schema_chars?: number;
  stable_prefix_sha256?: string;
  reasoning_effort?: string | null;
  max_output_tokens?: number | null;
  uncached_tokens?: number | null;
  response_bytes: number;
  usage: TokenUsage | null;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

const REASONING_EFFORTS: readonly string[] = ["none", "minimal", "low", "medium", "high"];

export interface RequestShape {
  request_bytes: number;
  tools_count: number;
  messages_count: number;
  system_chars: number;
  tool_schema_chars: number;
  stable_prefix_sha256: string;
  reasoning_effort: string | null;
  max_output_tokens: number | null;
}

function textFromContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  let text = "";
  for (const part of value) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    if (!isPlainObject(part)) continue;
    const nested = part.text;
    if (typeof nested === "string") text += nested;
  }
  return text;
}

function systemPrefixStrings(messages: readonly unknown[]): string[] {
  const prefix: string[] = [];
  for (const entry of messages) {
    if (!isPlainObject(entry)) break;
    const role = entry.role;
    if (role !== "system" && role !== "developer") break;
    const text = textFromContent(entry.content);
    prefix.push(text === null ? "" : text);
  }
  return prefix;
}

function firstPositiveInteger(
  source: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function readReasoningEffort(source: Record<string, unknown>): string | null {
  const candidates: unknown[] = [source.reasoning_effort];
  const reasoning = source.reasoning;
  if (isPlainObject(reasoning)) candidates.push(reasoning.effort);
  const thinking = source.thinking;
  if (isPlainObject(thinking)) candidates.push(thinking.effort);
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    return REASONING_EFFORTS.includes(candidate) ? candidate : null;
  }
  return null;
}

export function measureRequestShape(rawBody: unknown): RequestShape {
  const body = isPlainObject(rawBody) ? rawBody : {};
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const toolsJson = JSON.stringify(tools);
  const prefix = systemPrefixStrings(messages);
  const systemChars = prefix.reduce((total, text) => total + text.length, 0);
  const canonical = JSON.stringify({ tools, system: prefix });
  return {
    request_bytes: new TextEncoder().encode(JSON.stringify(body) ?? "").length,
    tools_count: tools.length,
    messages_count: messages.length,
    system_chars: systemChars,
    tool_schema_chars: toolsJson.length,
    stable_prefix_sha256: createHash("sha256").update(canonical).digest("hex"),
    reasoning_effort: readReasoningEffort(body),
    max_output_tokens: firstPositiveInteger(body, [
      "max_tokens",
      "max_completion_tokens",
      "max_output_tokens",
    ]),
  };
}

export function uncachedPromptTokens(usage: TokenUsage | null): number | null {
  if (usage === null) return null;
  const prompt = usage.prompt_tokens;
  const cacheRead = usage.cache_read_tokens;
  if (prompt === null || cacheRead === null) return null;
  return Math.max(0, prompt - cacheRead);
}

export function isGatewayFailureBody(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (raw.success === false) return true;
  if (raw.failure !== undefined && raw.failure !== null && raw.failure !== false) return true;
  const error = raw.error;
  if (typeof error === "string") return error.length > 0;
  if (Array.isArray(error)) return error.length > 0;
  return isPlainObject(error);
}

export interface ProxyCollector {
  beginRun(runId: string): void;
  endRun(runId: string): ProxyRequestRecord[];
  activeRunId(): string | null;
  record(entry: ProxyRequestRecord, runId?: string): boolean;
}

export function createProxyCollector(): ProxyCollector {
  let activeRunId: string | null = null;
  let buffer: ProxyRequestRecord[] = [];
  return {
    beginRun(runId: string): void {
      if (activeRunId !== null)
        throw new BenchmarkConfigError(`proxy run already active: ${activeRunId}`);
      activeRunId = runId;
      buffer = [];
    },
    endRun(runId: string): ProxyRequestRecord[] {
      if (activeRunId !== runId)
        throw new BenchmarkConfigError(`proxy run mismatch: expected ${String(activeRunId)}`);
      const records = buffer;
      buffer = [];
      activeRunId = null;
      return records;
    },
    activeRunId(): string | null {
      return activeRunId;
    },
    record(entry: ProxyRequestRecord, runId?: string): boolean {
      if (activeRunId === null || (runId !== undefined && activeRunId !== runId)) return false;
      buffer.push(entry);
      return true;
    },
  };
}

export interface CompletionMessageToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CompletionChoice {
  index: number;
  message: { role: string; content: string | null; tool_calls?: CompletionMessageToolCall[] };
  finish_reason: string | null;
}

export interface CompletionShape {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage?: unknown;
}

export interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function: { name?: string; arguments?: string };
}

export interface SseDelta {
  role?: string;
  content?: string;
  tool_calls?: DeltaToolCall[];
}

export interface SseChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{ index: number; delta: SseDelta; finish_reason: string | null }>;
  usage?: TokenUsage;
}

export interface SseEvent {
  data: string;
  done: boolean;
}

export function completionToSseChunks(completion: CompletionShape): SseChunk[] {
  const chunks: SseChunk[] = [];
  const base = {
    id: completion.id,
    object: "chat.completion.chunk" as const,
    created: completion.created,
    model: completion.model,
  };
  const usage = readUsage(completion.usage);
  for (const choice of completion.choices) {
    const push = (delta: SseDelta, finishReason: string | null, withUsage: boolean): void => {
      chunks.push({
        ...base,
        choices: [{ index: choice.index, delta, finish_reason: finishReason }],
        ...(withUsage && usage ? { usage } : {}),
      });
    };
    push({ role: choice.message.role }, null, false);
    if (choice.message.content !== null && choice.message.content !== undefined) {
      push({ content: choice.message.content }, null, false);
    }
    const toolCalls = choice.message.tool_calls ?? [];
    toolCalls.forEach((toolCall, index) => {
      push(
        {
          tool_calls: [
            {
              index,
              id: toolCall.id,
              type: toolCall.type,
              function: { name: toolCall.function.name, arguments: "" },
            },
          ],
        },
        null,
        false
      );
      push(
        { tool_calls: [{ index, function: { arguments: toolCall.function.arguments } }] },
        null,
        false
      );
    });
    push({}, choice.finish_reason, true);
  }
  if (chunks.length === 0) {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      ...(usage ? { usage } : {}),
    });
  }
  return chunks;
}

export function formatSseEvent(payload: string): string {
  return `data: ${payload}\n\n`;
}

export function serializeCompletionSse(completion: CompletionShape): string {
  const parts = completionToSseChunks(completion).map((chunk) =>
    formatSseEvent(JSON.stringify(chunk))
  );
  parts.push(formatSseEvent("[DONE]"));
  return parts.join("");
}

export function parseSseStream(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    events.push({ data, done: data === "[DONE]" });
  }
  return events;
}

export function reassembleCompletion(events: readonly SseEvent[]): CompletionShape {
  let id = "";
  let created = 0;
  let model = "";
  let usage: TokenUsage | null = null;
  const deltas = new Map<number, SseDelta>();
  const finishReasons = new Map<number, string | null>();
  for (const event of events) {
    if (event.done) continue;
    const chunk = JSON.parse(event.data) as SseChunk;
    id = chunk.id ?? id;
    created = chunk.created ?? created;
    model = chunk.model ?? model;
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const merged = deltas.get(choice.index) ?? {};
      if (choice.delta?.role) merged.role = choice.delta.role;
      if (choice.delta?.content !== undefined)
        merged.content = (merged.content ?? "") + choice.delta.content;
      for (const toolCall of choice.delta?.tool_calls ?? []) {
        const existing = merged.tool_calls?.[toolCall.index] ?? {
          index: toolCall.index,
          function: {},
        };
        const functionValue: { name?: string; arguments?: string } = { ...existing.function };
        if (toolCall.id) existing.id = toolCall.id;
        if (toolCall.type) existing.type = toolCall.type;
        if (toolCall.function?.name !== undefined) functionValue.name = toolCall.function.name;
        if (toolCall.function?.arguments !== undefined) {
          functionValue.arguments = (functionValue.arguments ?? "") + toolCall.function.arguments;
        }
        existing.function = functionValue;
        merged.tool_calls = merged.tool_calls ?? [];
        merged.tool_calls[toolCall.index] = existing;
      }
      deltas.set(choice.index, merged);
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        finishReasons.set(choice.index, choice.finish_reason);
      }
    }
  }
  const choices: CompletionChoice[] = [...deltas.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, delta]) => {
      const toolCalls = (delta.tool_calls ?? [])
        .filter((toolCall): toolCall is DeltaToolCall => toolCall !== undefined)
        .map((toolCall) => ({
          id: toolCall.id ?? "",
          type: "function" as const,
          function: {
            name: toolCall.function.name ?? "",
            arguments: toolCall.function.arguments ?? "",
          },
        }));
      const message: CompletionChoice["message"] = {
        role: delta.role ?? "assistant",
        content: delta.content ?? null,
      };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
      return { index, message, finish_reason: finishReasons.get(index) ?? null };
    });
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices,
    ...(usage ? { usage } : {}),
  };
}

export interface TemplateValues {
  workspace: string;
  prompt_file: string;
  model: string;
  proxy_url: string;
}

export function substituteTemplate(value: string, values: TemplateValues): string {
  return value
    .replaceAll("{workspace}", values.workspace)
    .replaceAll("{prompt_file}", values.prompt_file)
    .replaceAll("{model}", values.model)
    .replaceAll("{proxy_url}", values.proxy_url);
}

export function resolveUpstreamUrl(providerUrl: string): string {
  const trimmed = providerUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

export interface RunMetrics {
  run_id: string;
  round: number;
  sequence: number;
  task_id: string;
  harness_id: string;
  harness_kind: HarnessKind;
  status: RunStatus;
  started_at: string;
  ended_at: string;
  elapsed_ms: number;
  exit_code: number | null;
  proxy_url: string;
  requests: ProxyRequestRecord[];
  usage: UsageAggregate;
  assertions: AssertionResult[];
  passed: number;
  total: number;
  all_passed: boolean;
  stdout_bytes: number;
  stderr_bytes: number;
  error: string | null;
}

export interface HarnessSummary {
  harness_id: string;
  harness_kind: HarnessKind;
  runs: number;
  ok_runs: number;
  passed_runs: number;
  correctness_rate: number | null;
  total_elapsed_ms: number;
  mean_elapsed_ms: number | null;
  median_elapsed_ms: number | null;
  p95_elapsed_ms: number | null;
  proxy_requests: number;
  usage: UsageAggregate;
}

export interface BenchmarkReport {
  schema_version: 1;
  generated_at: string;
  model: string;
  rounds: number;
  seed: number;
  planned_runs: number;
  stream_mode: "buffered";
  proxy: {
    intercept_path: "/v1/chat/completions";
    upstream_stream: false;
    model_enforced: true;
    provider_key_env: string;
  };
  totals: {
    runs: number;
    ok_runs: number;
    passed_runs: number;
    correctness_rate: number | null;
    proxy_requests: number;
    usage: UsageAggregate;
  };
  harnesses: HarnessSummary[];
  runs: RunMetrics[];
}

function quantile(sorted: readonly number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(3));
}

export function summarizeHarness(
  harnessId: string,
  harnessKind: HarnessKind,
  runs: readonly RunMetrics[]
): HarnessSummary {
  const elapsed = runs.map((run) => run.elapsed_ms).sort((left, right) => left - right);
  const requests = runs.flatMap((run) => run.requests);
  const okRuns = runs.filter((run) => run.status === "ok").length;
  const passedRuns = runs.filter((run) => run.all_passed).length;
  return {
    harness_id: harnessId,
    harness_kind: harnessKind,
    runs: runs.length,
    ok_runs: okRuns,
    passed_runs: passedRuns,
    correctness_rate: runs.length === 0 ? null : Number((passedRuns / runs.length).toFixed(6)),
    total_elapsed_ms: elapsed.reduce((sum, value) => sum + value, 0),
    mean_elapsed_ms: roundOrNull(mean(elapsed)),
    median_elapsed_ms: roundOrNull(quantile(elapsed, 0.5)),
    p95_elapsed_ms: roundOrNull(quantile(elapsed, 0.95)),
    proxy_requests: requests.length,
    usage: sumUsages(requests.map((request) => request.usage)),
  };
}

export function buildReport(
  config: BenchmarkConfig,
  plan: readonly PlannedRun[],
  runs: readonly RunMetrics[],
  seed: number,
  generatedAt: string
): BenchmarkReport {
  const summaries = config.harnesses.map((harness) =>
    summarizeHarness(
      harness.id,
      harness.kind,
      runs.filter((run) => run.harness_id === harness.id)
    )
  );
  const requests = runs.flatMap((run) => run.requests);
  const passedRuns = runs.filter((run) => run.all_passed).length;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    model: config.model,
    rounds: config.rounds,
    seed,
    planned_runs: plan.length,
    stream_mode: "buffered",
    proxy: {
      intercept_path: "/v1/chat/completions",
      upstream_stream: false,
      model_enforced: true,
      provider_key_env: config.provider_key_env,
    },
    totals: {
      runs: runs.length,
      ok_runs: runs.filter((run) => run.status === "ok").length,
      passed_runs: passedRuns,
      correctness_rate: runs.length === 0 ? null : Number((passedRuns / runs.length).toFixed(6)),
      proxy_requests: requests.length,
      usage: sumUsages(requests.map((request) => request.usage)),
    },
    harnesses: summaries,
    runs: [...runs],
  };
}

export function formatReportLines(report: BenchmarkReport): string[] {
  const lines: string[] = [];
  lines.push(
    `model ${report.model} rounds ${report.rounds} runs ${report.totals.runs} stream_mode ${report.stream_mode}`
  );
  for (const summary of report.harnesses) {
    const usage = summary.usage;
    lines.push(
      [
        summary.harness_id,
        summary.harness_kind,
        `runs=${summary.runs}`,
        `ok=${summary.ok_runs}`,
        `correct=${summary.passed_runs}/${summary.runs}`,
        `mean_ms=${summary.mean_elapsed_ms ?? "null"}`,
        `p95_ms=${summary.p95_elapsed_ms ?? "null"}`,
        `requests=${summary.proxy_requests}`,
        `prompt=${usage.prompt_tokens ?? "null"}`,
        `completion=${usage.completion_tokens ?? "null"}`,
        `cache_read=${usage.cache_read_tokens ?? "null"}`,
        `usage_complete=${usage.complete}`,
      ].join(" ")
    );
  }
  return lines;
}
