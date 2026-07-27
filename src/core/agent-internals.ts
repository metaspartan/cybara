export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  [key: string]: unknown;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  first_token_ms?: number;
  generation_duration_ms?: number;
}

export interface OpenAICodexToolCall {
  id: string;
  callId: string;
  itemId?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface OpenAICodexUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
}

export interface OpenAICodexTurnResult {
  content: string;
  toolCalls: OpenAICodexToolCall[];
  usage?: OpenAICodexUsage;
  firstTokenMs?: number;
}

export interface AnthropicContentBlock {
  type: "text" | "tool_use" | "thinking" | "redacted_thinking";
  text?: string;
  thinking?: string;
  signature?: string;
  data?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  usage?: AnthropicUsage;
}

export interface GooglePartText {
  text?: string;
}

export interface GooglePartFunctionCall {
  functionCall?: {
    name?: string;
    args?: unknown;
  };
}

export interface GooglePartFunctionResponse {
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
}

export type GooglePart = GooglePartText & GooglePartFunctionCall & GooglePartFunctionResponse;

export interface GoogleContent {
  role?: "user" | "model";
  parts?: GooglePart[];
}

export interface GoogleCandidate {
  content?: GoogleContent;
  finishReason?: string;
}

export interface GoogleUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface GoogleResponse {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
}

export const ANTHROPIC_CONTEXT_1M_BETA = "context-1m-2025-08-07";
export const OPENAI_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
export const OPENAI_CODEX_OAUTH_MODEL_PREFIXES = ["gpt-5.3-codex", "gpt-5.2-codex"] as const;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 131072;
export const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 4;
export const CONTEXT_INPUT_HEADROOM_RATIO = 0.75;
export const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;
export const HARD_MAX_TOOL_RESULT_CHARS = 6_000;
export const MIN_TOOL_RESULT_CHARS = 2_000;
export const CONTEXT_LIMIT_TRUNCATION_NOTICE = "[truncated: output exceeded context limit]";
export const CONVERSATION_KEEP_RECENT_MESSAGES = 16;
export const CONVERSATION_MAX_MESSAGES = 60;
export const CONVERSATION_SUMMARY_MAX_CHARS = 8_000;
export const CONVERSATION_SUMMARY_PREFIX =
  "[Earlier conversation summary - prior turns condensed to save context]";
export const MAX_AGENTIC_CONFIGURED_ITERATIONS = 10000;
export const MAX_AGENTIC_MAX_RUNTIME_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_AGENTIC_MAX_ITERATIONS = 300;
export const DEFAULT_AGENTIC_MAX_RUNTIME_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_TOOL_LOOP_WARNING_THRESHOLD = 10;
export const DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD = 20;
export const DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;
export const LOOP_WARNING_BUCKET_SIZE = 10;

export type AgenticLoopPolicy = {
  maxIterations?: number;
  maxRuntimeMs?: number;
  loopDetectionEnabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
};

export type AgenticLoopState = {
  previousFingerprint?: string;
  noProgressStreak: number;
  warningBucket: number;
};

export interface AgentToolCallResult {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result: unknown;
  status?: "pending" | "executing" | "completed" | "failed";
  duration?: number;
  timeline_index?: number;
}

export function normalizeGoogleModelId(modelId: string): string {
  let normalized = modelId.trim();
  if (!normalized) return modelId;

  if (normalized.startsWith("models/")) {
    normalized = normalized.slice("models/".length);
  }

  const providerPrefix = /^(google|gemini|google-gemini-cli|antigravity|google-antigravity)\//i;
  if (providerPrefix.test(normalized)) {
    normalized = normalized.replace(providerPrefix, "");
  }

  if (normalized === "gemini-3-pro") return "gemini-3-pro-preview";
  if (normalized === "gemini-3-flash") return "gemini-3-flash-preview";
  return normalized;
}

export function parseGoogleAuthHeaders(
  auth: string,
  providerAuthType: string
): { headers: Record<string, string> } {
  const trimmed = auth.trim();

  if (trimmed.startsWith("{")) {
    const parsedToken = (() => {
      try {
        const parsed = JSON.parse(trimmed) as { token?: string };
        if (typeof parsed.token === "string" && parsed.token.trim()) {
          return parsed.token.trim();
        }
      } catch {
        return undefined;
      }
      return undefined;
    })();
    if (parsedToken) {
      return {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${parsedToken}`,
        },
      };
    }
  }

  const normalizedAuthType = providerAuthType.trim().toLowerCase();
  if (normalizedAuthType === "oauth" || normalizedAuthType === "token") {
    return {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmed}`,
      },
    };
  }

  return {
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": trimmed,
    },
  };
}

export function parseAgentConfig(config: unknown, agentId?: string): Record<string, unknown> {
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      console.warn(
        `[Agent] Invalid agent config JSON${agentId ? ` for ${agentId}` : ""}; using empty config`
      );
      return {};
    }
  }

  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }

  return {};
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function repairJsonArguments(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (!text) return null;

  text = text
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const attempts: string[] = [text];
  const balanced = extractBalancedJsonObject(text);
  if (balanced && balanced !== text) attempts.push(balanced);
  for (const candidate of [...attempts]) {
    const noTrailingCommas = candidate.replace(/,(\s*[}\]])/g, "$1");
    if (noTrailingCommas !== candidate) attempts.push(noTrailingCommas);
  }

  for (const candidate of attempts) {
    try {
      const parsed = asPlainObject(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  const asObject = asPlainObject(raw);
  if (asObject) return asObject;
  if (typeof raw !== "string") return {};
  try {
    const parsed = asPlainObject(JSON.parse(raw));
    if (parsed) return parsed;
  } catch {}
  return repairJsonArguments(raw) ?? {};
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let delimiter = buffer.indexOf("\n\n");
      while (delimiter !== -1) {
        const chunk = buffer.slice(0, delimiter);
        buffer = buffer.slice(delimiter + 2);

        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line.length > 0 && line !== "[DONE]");

        if (dataLines.length > 0) {
          const data = dataLines.join("\n");
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            yield parsed;
          } catch {}
        }

        delimiter = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function stableSerializeForLoop(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerializeForLoop(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerializeForLoop(entryValue)}`)
    .join(",")}}`;
}

export function buildToolIterationFingerprint(toolCalls: AgentToolCallResult[]): string {
  return toolCalls
    .map(
      (toolCall) =>
        `${toolCall.name}:${stableSerializeForLoop(toolCall.args || {})}:${stableSerializeForLoop(
          toolCall.result
        )}`
    )
    .sort()
    .join("|");
}

export function readStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function readNumberArg(args: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function summarizeCommand(command: string): string {
  const compact = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return "command";
  if (compact.length > 72) return `${compact.slice(0, 69)}...`;
  return compact;
}

const REASONING_MARKUP_TOKEN_PATTERN =
  /<\/?(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning|final)\b[^>]*>|\[\/?(?:thinking|reasoning)\]/gi;

export function stripReasoningTagTokens(value: string): string {
  return value.replace(REASONING_MARKUP_TOKEN_PATTERN, " ");
}

export function summarizeProgressThought(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = stripReasoningTagTokens(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!compact) return undefined;
  const maximumLength = 500;
  if (compact.length <= maximumLength) return compact;
  const candidate = compact.slice(0, maximumLength + 1);
  const sentenceBoundaries = [
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  ];
  const sentenceBoundary = Math.max(...sentenceBoundaries);
  if (sentenceBoundary >= 80) return candidate.slice(0, sentenceBoundary + 1);
  const wordBoundary = candidate.lastIndexOf(" ", maximumLength - 1);
  const end = wordBoundary >= 80 ? wordBoundary : maximumLength;
  return `${candidate.slice(0, end).trimEnd()}…`;
}

export function toDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSandboxProvider(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "apple_sandbox" ||
    normalized === "podman" ||
    normalized === "docker" ||
    normalized === "host"
  ) {
    return normalized;
  }
  return undefined;
}

export function extractSandboxProviderFromToolResult(result: unknown): string | undefined {
  if (!isObjectRecord(result)) return undefined;
  return normalizeSandboxProvider(result.sandboxProvider ?? result.sandbox_provider);
}

export function formatToolErrorSummary(error: unknown): string | undefined {
  const raw =
    typeof error === "string"
      ? error
      : isObjectRecord(error) && typeof error.error === "string"
        ? error.error
        : isObjectRecord(error) && typeof error.message === "string"
          ? error.message
          : undefined;
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

export function appendToolErrorSummary(label: string, error: unknown): string {
  const summary = formatToolErrorSummary(error);
  return summary ? `${label}: ${summary}` : label;
}

export function formatToolActivityDetail(
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "result" | "error" | "blocked",
  result?: unknown
): string {
  const key = toolName.toLowerCase();
  const path = readStringArg(args, ["path", "file_path", "filePath"]);

  if (key === "sessions_transfer") {
    const target = readStringArg(args, ["agentName", "agentId"]) || "another agent";
    if (phase === "start") return `Transferring to ${target}...`;
    if (phase === "result") return `Transferred to ${target}`;
    return appendToolErrorSummary(
      phase === "blocked" ? `Transfer blocked for ${target}` : `Transfer failed for ${target}`,
      result
    );
  }

  if (key === "read") {
    if (path) {
      const offset = readNumberArg(args, ["offset"]);
      const limit = readNumberArg(args, ["limit"]);
      if (offset !== undefined && limit !== undefined && limit > 0) {
        const startLine = Math.max(1, Math.floor(offset));
        const lineCount = Math.max(1, Math.floor(limit));
        const endLine = startLine + lineCount - 1;
        return phase === "start"
          ? `Exploring ${path} (lines ${startLine}-${endLine})`
          : phase === "result"
            ? `Explored ${path} (lines ${startLine}-${endLine})`
            : appendToolErrorSummary(
                `${phase === "blocked" ? "Read blocked for" : "Read failed for"} ${path}`,
                result
              );
      }
      return phase === "start"
        ? `Exploring ${path}`
        : phase === "result"
          ? `Explored ${path}`
          : appendToolErrorSummary(
              `${phase === "blocked" ? "Read blocked for" : "Read failed for"} ${path}`,
              result
            );
    }
    return phase === "start"
      ? "Exploring files..."
      : phase === "result"
        ? "Exploration complete"
        : appendToolErrorSummary(phase === "blocked" ? "Read blocked" : "Read failed", result);
  }

  if (key === "write" || key === "edit") {
    let resultChange: Record<string, unknown> | undefined;
    if (isObjectRecord(result) && isObjectRecord(result.change)) {
      resultChange = result.change;
    }
    const resultPath =
      readStringArg(resultChange || {}, ["path"]) ||
      (isObjectRecord(result) ? readStringArg(result, ["path"]) : undefined) ||
      path;
    const displayPath = resultPath ? toDisplayPath(resultPath) : undefined;
    const addedLines = toFiniteNumber(resultChange?.addedLines);
    const removedLines = toFiniteNumber(resultChange?.removedLines);

    if (path) {
      const startPath = displayPath || toDisplayPath(path);
      if (phase === "start")
        return key === "edit" ? `Editing ${startPath}` : `Writing ${startPath}`;
      if (phase === "result") {
        if (addedLines !== undefined && removedLines !== undefined && displayPath) {
          return `Edited ${displayPath} +${addedLines} -${removedLines}`;
        }
        return `Edited ${displayPath || startPath}`;
      }
      return `Edit failed for ${displayPath || startPath}`;
    }
    if (phase === "start") return key === "edit" ? "Editing file..." : "Writing file...";
    if (phase === "result") {
      if (addedLines !== undefined && removedLines !== undefined) {
        return `Edited file +${addedLines} -${removedLines}`;
      }
      return "Edit complete";
    }
    return "Edit failed";
  }

  if (key === "file_search" || key === "grep") {
    if (phase === "result" && isObjectRecord(result)) {
      const files = Array.isArray(result.files) ? result.files : undefined;
      const count = toFiniteNumber(result.count) || (files ? files.length : undefined);
      if (count !== undefined) {
        const safeCount = Math.max(0, Math.floor(count));
        return `Explored ${safeCount} file${safeCount === 1 ? "" : "s"}, 1 search`;
      }
    }
    const pattern = readStringArg(args, ["pattern", "query"]);
    const basePath = readStringArg(args, ["path"]);
    if (pattern && basePath) {
      return phase === "start"
        ? `Searching ${basePath} for "${pattern}"`
        : phase === "result"
          ? `Searched ${basePath} for "${pattern}"`
          : `Search failed in ${basePath}`;
    }
    if (pattern) {
      return phase === "start"
        ? `Searching for "${pattern}"`
        : phase === "result"
          ? `Search complete for "${pattern}"`
          : `Search failed for "${pattern}"`;
    }
    return phase === "start"
      ? "Searching files..."
      : phase === "result"
        ? "Search complete"
        : "Search failed";
  }

  if (key === "web_search") {
    const query = readStringArg(args, ["query"]);
    if (query) {
      return phase === "start"
        ? `Searching web for "${query}"`
        : phase === "result"
          ? `Web search complete for "${query}"`
          : `Web search failed for "${query}"`;
    }
    return phase === "start"
      ? "Searching the web..."
      : phase === "result"
        ? "Web search complete"
        : "Web search failed";
  }

  if (key === "web_fetch") {
    const url = readStringArg(args, ["url"]);
    if (url) {
      return phase === "start"
        ? `Fetching ${url}`
        : phase === "result"
          ? `Fetched ${url}`
          : `Fetch failed for ${url}`;
    }
    return phase === "start"
      ? "Fetching webpage..."
      : phase === "result"
        ? "Fetch complete"
        : "Fetch failed";
  }

  if (key === "exec" || key === "process" || key === "git") {
    const command = readStringArg(args, ["command", "cmd"]);
    if (command) {
      const summary = summarizeCommand(command);
      return phase === "start"
        ? `Running ${summary}`
        : phase === "result"
          ? `Ran ${summary}`
          : `Command failed: ${summary}`;
    }
    return phase === "start"
      ? "Running command..."
      : phase === "result"
        ? "Command complete"
        : "Command failed";
  }

  if (key === "browser") {
    const action = readStringArg(args, ["action"]);
    if (action) {
      return phase === "start"
        ? `Browser: ${action}`
        : phase === "result"
          ? `Browser ${action} complete`
          : `Browser ${action} failed`;
    }
    return phase === "start"
      ? "Browser action..."
      : phase === "result"
        ? "Browser action complete"
        : "Browser action failed";
  }

  if (key === "artifacts" || key === "artifact") {
    const action = (readStringArg(args, ["action"]) || "list").toLowerCase();
    const artifactNameRaw =
      readStringArg(args, ["name", "artifact", "artifactName", "fileName"]) ||
      readStringArg(args, ["kind", "type"]) ||
      "artifact";
    const artifactName = artifactNameRaw.endsWith(".md.resolved")
      ? artifactNameRaw
      : `${artifactNameRaw}.md.resolved`;

    if (action === "list") {
      return phase === "start"
        ? "Listing session artifacts..."
        : phase === "result"
          ? "Listed session artifacts"
          : "Artifact listing failed";
    }
    if (action === "create") {
      return phase === "start"
        ? `Creating ${artifactName}`
        : phase === "result"
          ? `Created ${artifactName}`
          : `Artifact create failed for ${artifactName}`;
    }
    if (action === "read") {
      return phase === "start"
        ? `Reading ${artifactName}`
        : phase === "result"
          ? `Read ${artifactName}`
          : `Artifact read failed for ${artifactName}`;
    }
    if (action === "update" || action === "append" || action === "check") {
      return phase === "start"
        ? `Updating ${artifactName}`
        : phase === "result"
          ? `Updated ${artifactName}`
          : `Artifact update failed for ${artifactName}`;
    }
    if (action === "delete") {
      return phase === "start"
        ? `Deleting ${artifactName}`
        : phase === "result"
          ? `Deleted ${artifactName}`
          : `Artifact delete failed for ${artifactName}`;
    }
  }

  if (phase === "start") return `${toolName} running...`;
  if (phase === "result") return `${toolName} complete`;
  return `${toolName} failed`;
}

export function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function parseModelParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
