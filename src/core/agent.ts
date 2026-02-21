import { tables, type Agent, type ToolDefinition } from "./database";
import {
  providerManager,
  getProviderBaseUrl,
  getDefaultModel,
  providers as providerCatalog,
  type ProviderType,
} from "./providers";
import { getToolSchemasForLLM, isToolEnabledForAgent, type ToolContext } from "./tools/index";
import { executeTool, hasTool } from "./tools/handlers/index";
import {
  buildSystemPrompt,
  AGENT_TYPE_PROMPTS,
  resolveModelAlias,
  getDefaultSystemPrompt,
} from "./system-prompt";
import { broadcastStatus, type AgentStatus, type StatusPayload } from "./status";
import { homedir } from "os";
import { loadAllSkills, createEligibilityContext, filterEligibleSkills } from "./skills";
import { emitAgentHook, type AgentHookContext } from "./agent-hooks";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ContentBlock as BedrockContentBlock,
  type Message as BedrockMessage,
  type ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType as SmithyDocumentType } from "@smithy/types";

export interface AgentDefinition {
  name: string;
  type?: "main" | "research" | "coder" | "planner" | "ops" | "subagent" | "worker";
  model?: string;
  provider_id?: string;
  provider?: string;
  fallback_provider_id?: string;
  fallback_provider?: string;
  system_prompt?: string;
  tools?: ToolDefinition[];
  memory_enabled?: boolean;
  config?: Record<string, unknown>;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  [key: string]: unknown;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

interface OpenAICodexToolCall {
  id: string;
  callId: string;
  itemId?: string;
  name: string;
  args: Record<string, unknown>;
}

interface OpenAICodexUsage {
  inputTokens: number;
  outputTokens: number;
}

interface OpenAICodexTurnResult {
  content: string;
  toolCalls: OpenAICodexToolCall[];
  usage?: OpenAICodexUsage;
}

interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  usage?: AnthropicUsage;
}

interface GooglePartText {
  text?: string;
}

interface GooglePartFunctionCall {
  functionCall?: {
    name?: string;
    args?: unknown;
  };
}

interface GooglePartFunctionResponse {
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
}

type GooglePart = GooglePartText & GooglePartFunctionCall & GooglePartFunctionResponse;

interface GoogleContent {
  role?: "user" | "model";
  parts?: GooglePart[];
}

interface GoogleCandidate {
  content?: GoogleContent;
  finishReason?: string;
}

interface GoogleUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GoogleResponse {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
}

const ANTHROPIC_CONTEXT_1M_BETA = "context-1m-2025-08-07";
const OPENAI_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_CODEX_OAUTH_MODEL_PREFIXES = ["gpt-5.3-codex", "gpt-5.2-codex"] as const;
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 8192;
const MAX_AGENTIC_CONFIGURED_ITERATIONS = 10000;
const MAX_AGENTIC_MAX_RUNTIME_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOOL_LOOP_WARNING_THRESHOLD = 10;
const DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD = 20;
const DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;
const LOOP_WARNING_BUCKET_SIZE = 10;

type AgenticLoopPolicy = {
  maxIterations?: number;
  maxRuntimeMs?: number;
  loopDetectionEnabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
};

type AgenticLoopState = {
  previousFingerprint?: string;
  noProgressStreak: number;
  warningBucket: number;
};

function trackTokenUsage(
  model: string,
  provider: string,
  providerUrl: string,
  inputTokens: number,
  outputTokens: number,
  durationMs?: number
) {
  try {
    const totalTokens = inputTokens + outputTokens;
    const callId = crypto.randomUUID();
    const timestamp = Date.now();
    const tokenMetadata = {
      callId,
      model,
      provider,
      providerUrl,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: durationMs ?? null,
      timestamp,
    };

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_model",
      key: model,
      value: totalTokens,
      metadata: JSON.stringify(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_provider",
      key: provider,
      value: totalTokens,
      metadata: JSON.stringify({ ...tokenMetadata, url: providerUrl }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "input",
      value: inputTokens,
      metadata: JSON.stringify({ ...tokenMetadata, direction: "input" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "output",
      value: outputTokens,
      metadata: JSON.stringify({ ...tokenMetadata, direction: "output" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "all",
      value: totalTokens,
      metadata: JSON.stringify(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "all",
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "success",
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: provider,
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });

    tables.metrics.add({ id: crypto.randomUUID(), type: "agent_execution", key: "all", value: 1 });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "agent_execution",
      key: "message",
      value: 1,
      metadata: JSON.stringify({ timestamp }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "system_status",
      key: "last_activity",
      value: timestamp,
    });

    if (durationMs && durationMs > 0) {
      const tps = Math.round((outputTokens / durationMs) * 1000); // output tokens per second

      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_tps",
        key: model,
        value: tps,
        metadata: JSON.stringify(tokenMetadata),
      });

      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_latency",
        key: model,
        value: durationMs,
        metadata: JSON.stringify({ ...tokenMetadata, provider }),
      });

      console.log(
        `[Metrics] TPS: ${tps} tok/s (${outputTokens} tokens in ${durationMs}ms) for ${model}`
      );
    }

    broadcastStatus({ status: "thinking", timestamp: Date.now() });

    console.log(
      `[Metrics] Tracked tokens: input=${inputTokens}, output=${outputTokens}, model=${model}, provider=${provider}`
    );
  } catch (e) {
    console.error("[Metrics] Token tracking failed:", e);
  }
}

export function getBuiltinTools(): ToolDefinition[] {
  return getToolSchemasForLLM().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}

export const AGENT_TYPES = {
  main: {
    description: "General-purpose assistant",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.main,
  },
  research: {
    description: "Research and information gathering",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.research,
  },
  coder: {
    description: "Coding and software development",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.coder,
  },
  planner: {
    description: "Planning and task breakdown",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.planner,
  },
  ops: {
    description: "Operations and system administration",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.ops,
  },
  subagent: {
    description: "Subagent for delegated tasks",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.main,
  },
  worker: {
    description: "Worker for background tasks",
    defaultModel: "MiniMax-M2.5",
    systemPrompt: AGENT_TYPE_PROMPTS.main,
  },
};

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_call_id?: string;
}

interface AgentExecutionOptions {
  stream?: boolean;
  useTools?: boolean;
  sessionId?: string;
  workspaceDir?: string;
  channel?: string;
  userId?: string;
  modelOverride?: string;
  requireToolUse?: boolean;
}

interface RunningAgentState {
  agent: Agent;
  startedAt: Date;
  pid: number;
  messages: AgentMessage[];
  lastActive: Date;
}

interface AgentToolCallResult {
  name: string;
  args?: Record<string, unknown>;
  result: unknown;
}

function normalizeGoogleModelId(modelId: string): string {
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

function parseGoogleAuthHeaders(
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

function parseAgentConfig(config: unknown, agentId?: string): Record<string, unknown> {
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

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function* parseServerSentEvents(
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
          } catch {
            // Ignore malformed SSE chunks
          }
        }

        delimiter = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function toOpenAIReplayAssistantMessage(message: OpenAIMessage): Record<string, unknown> {
  const replayMessage: Record<string, unknown> = {
    role: typeof message.role === "string" && message.role.trim() ? message.role : "assistant",
    content: typeof message.content === "string" ? message.content : "",
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    replayMessage.tool_calls = message.tool_calls;
  }

  for (const [key, value] of Object.entries(message)) {
    if (key === "role" || key === "content" || key === "tool_calls") continue;
    if (value !== undefined) {
      replayMessage[key] = value;
    }
  }

  return replayMessage;
}

function stableSerializeForLoop(value: unknown): string {
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

function buildToolIterationFingerprint(toolCalls: AgentToolCallResult[]): string {
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

function readStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function readNumberArg(args: Record<string, unknown>, keys: string[]): number | undefined {
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

function summarizeCommand(command: string): string {
  const compact = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return "command";
  if (compact.length > 72) return `${compact.slice(0, 69)}...`;
  return compact;
}

function summarizeProgressThought(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return undefined;
  if (compact.length <= 220) return compact;
  return `${compact.slice(0, 217)}...`;
}

function toDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatToolActivityDetail(
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "result" | "error",
  result?: unknown
): string {
  const key = toolName.toLowerCase();
  const path = readStringArg(args, ["path", "file_path", "filePath"]);

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
            : `Read failed for ${path}`;
      }
      return phase === "start"
        ? `Exploring ${path}`
        : phase === "result"
          ? `Explored ${path}`
          : `Read failed for ${path}`;
    }
    return phase === "start"
      ? "Exploring files..."
      : phase === "result"
        ? "Exploration complete"
        : "Read failed";
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

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function parseModelParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

class AgentManager {
  private runningAgents: Map<string, RunningAgentState> = new Map();

  private formatLlmFailure(error: unknown): string {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message || "")
        : String(error || "");
    const lower = message.toLowerCase();

    if (lower.includes("invalid_api_key") || lower.includes("incorrect api key")) {
      return "OpenAI API key was rejected. Update your OpenAI provider key in Providers.";
    }
    if (lower.includes("openai codex oauth provider")) {
      return "This model requires OpenAI Codex OAuth. Configure an OpenAI Codex provider and try again.";
    }
    if (lower.includes("model_not_found") || lower.includes("does not exist")) {
      return "Configured model is not available for this provider. Select another model and try again.";
    }
    if (lower.includes("insufficient_quota") || lower.includes("quota")) {
      return "Provider quota/billing limit reached. Update billing or use a different provider.";
    }
    if (lower.includes("401")) {
      return "Provider authentication failed (401). Verify your provider API key/token.";
    }
    if (lower.includes("403")) {
      return "Provider rejected access (403). Verify account permissions and model access.";
    }
    if (lower.includes("429") || lower.includes("rate limit")) {
      return "Provider rate limit hit (429). Retry shortly or switch providers.";
    }

    return "I apologize, but I encountered an issue processing your request. Please try again or rephrase your message.";
  }

  private shouldUseOpenAICodexProvider(
    provider: ReturnType<typeof providerManager.getWithCredentials> | undefined,
    model: string | undefined
  ): boolean {
    if (!provider || provider.provider !== "openai" || typeof model !== "string") {
      return false;
    }
    const normalizedModel = model.trim().toLowerCase();
    if (!normalizedModel) {
      return false;
    }
    return OPENAI_CODEX_OAUTH_MODEL_PREFIXES.some(
      (prefix) => normalizedModel === prefix || normalizedModel.startsWith(`${prefix}-`)
    );
  }

  private resolveProviderModelForExecution(
    provider: NonNullable<ReturnType<typeof providerManager.getWithCredentials>>,
    model: string | undefined
  ): {
    provider: NonNullable<ReturnType<typeof providerManager.getWithCredentials>>;
    model: string | undefined;
  } {
    if (!this.shouldUseOpenAICodexProvider(provider, model)) {
      return { provider, model };
    }

    const codexProviderId = providerManager.resolveProviderId("openai-codex");
    if (!codexProviderId) {
      throw new Error(
        "Model requires OpenAI Codex OAuth provider, but no openai-codex provider is configured."
      );
    }

    const codexProvider = providerManager.getWithCredentials(codexProviderId);
    if (!codexProvider) {
      throw new Error(
        "Model requires OpenAI Codex OAuth provider, but no credentialed openai-codex provider is available."
      );
    }

    if (provider.id !== codexProvider.id) {
      console.log(
        `[Agent] Normalized model ${model} from provider ${provider.provider} to ${codexProvider.provider}`
      );
    }

    return { provider: codexProvider, model };
  }

  private resolveProviderForAgent(
    agent: Pick<Agent, "id" | "provider_id" | "config">,
    persistIfResolved = false
  ): ReturnType<typeof providerManager.getWithCredentials> {
    let resolvedProvider =
      typeof agent.provider_id === "string" && agent.provider_id.trim()
        ? providerManager.getWithCredentials(agent.provider_id)
        : undefined;

    if (resolvedProvider) return resolvedProvider;

    const config = parseAgentConfig(agent.config, agent.id);
    const configProviderInput =
      typeof config.provider_id === "string"
        ? config.provider_id
        : typeof config.provider === "string"
          ? config.provider
          : undefined;

    const resolvedProviderId =
      providerManager.resolveProviderId(configProviderInput) ||
      providerManager.getPreferredProvider({ preferCredentialed: true })?.id;

    if (!resolvedProviderId) return undefined;

    resolvedProvider = providerManager.getWithCredentials(resolvedProviderId);
    if (!resolvedProvider) return undefined;

    if (persistIfResolved && agent.provider_id !== resolvedProviderId) {
      this.update(agent.id, { provider_id: resolvedProviderId });
      if ("provider_id" in agent) {
        agent.provider_id = resolvedProviderId;
      }
    }

    return resolvedProvider;
  }

  resolveProvider(id: string): ReturnType<typeof providerManager.getWithCredentials> {
    const agent = this.get(id);
    if (!agent) return undefined;
    return this.resolveProviderForAgent(agent, true);
  }

  list(): (Agent & {
    provider?: string;
    providerInfo?: { name: string };
    typeConfig?: typeof AGENT_TYPES.main;
  })[] {
    const all = tables.agents.all() as Agent[];
    return all.map((a) => {
      const provider = a.provider_id ? providerManager.get(a.provider_id) : undefined;
      const typeConfig = a.type ? AGENT_TYPES[a.type as keyof typeof AGENT_TYPES] : undefined;
      const status = this.runningAgents.has(a.id) ? "running" : "stopped";
      return {
        ...a,
        status,
        provider: a.provider_id, // Frontend expects provider ID as 'provider'
        providerInfo: provider ? { name: provider.name } : undefined,
        typeConfig,
      };
    });
  }

  get(
    id: string
  ): (Agent & { provider?: string; typeConfig?: typeof AGENT_TYPES.main }) | undefined {
    const agent = tables.agents.get(id) as Agent | undefined;
    if (!agent) return undefined;
    const typeConfig = agent.type ? AGENT_TYPES[agent.type as keyof typeof AGENT_TYPES] : undefined;
    const status = this.runningAgents.has(agent.id) ? "running" : "stopped";
    return {
      ...agent,
      status,
      provider: agent.provider_id, // Frontend expects provider ID as 'provider'
      typeConfig,
    };
  }

  create(definition: AgentDefinition): Agent {
    const id = crypto.randomUUID();

    const typeConfig = definition.type ? AGENT_TYPES[definition.type] : undefined;

    const resolvedModel = definition.model
      ? resolveModelAlias(definition.model, undefined)
      : typeConfig?.defaultModel;

    const systemPrompt =
      definition.system_prompt || typeConfig?.systemPrompt || AGENT_TYPE_PROMPTS.main;

    const resolvedProviderId =
      providerManager.resolveProviderId(definition.provider_id || definition.provider) ||
      definition.provider_id;
    const resolvedFallbackProviderId =
      providerManager.resolveProviderId(
        definition.fallback_provider_id || definition.fallback_provider
      ) || definition.fallback_provider_id;

    const agent: Agent = {
      id,
      name: definition.name,
      type: definition.type || "main",
      model: resolvedModel,
      provider_id: resolvedProviderId,
      fallback_provider_id: resolvedFallbackProviderId,
      system_prompt: systemPrompt,
      tools: definition.tools ?? getBuiltinTools(),
      config: definition.config || {},
      status: "stopped",
      memory_enabled: definition.memory_enabled || false,
    };

    tables.agents.create(agent);
    return agent;
  }

  createDefault(): Agent {
    const defaultProvider =
      providerManager.getPreferredProvider({ preferCredentialed: true }) ||
      providerManager.getPreferredProvider();
    const providerInfo = defaultProvider
      ? providerCatalog[defaultProvider.provider as ProviderType]
      : undefined;

    return this.create({
      name: "Mini",
      type: "research",
      model: providerInfo?.models?.[0]?.id || "MiniMax-M2.5",
      provider_id: defaultProvider?.id,
      system_prompt: AGENT_TYPE_PROMPTS.research,
      tools: getBuiltinTools(),
      memory_enabled: true,
    });
  }

  async createWithSystemPrompt(definition: Omit<AgentDefinition, "system_prompt">): Promise<Agent> {
    const typeConfig = definition.type ? AGENT_TYPES[definition.type] : undefined;
    const homeDir = process.env.HOME || homedir();

    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: undefined,
      config: {},
      modelDisplay: definition.model || typeConfig?.defaultModel || "MiniMax-M2.5",
      tools: (definition.tools ?? getBuiltinTools()).map((t) => t.name),
      skills: eligibleSkills,
    });

    return this.create({
      ...definition,
      system_prompt: systemPrompt,
    });
  }

  update(id: string, updates: Partial<AgentDefinition>): Agent | null {
    const existing = this.get(id);
    if (!existing) return null;

    let resolvedModel = updates.model;
    if (resolvedModel) {
      resolvedModel = resolveModelAlias(resolvedModel, undefined);
    }

    const resolvedProviderId =
      updates.provider_id !== undefined || updates.provider !== undefined
        ? providerManager.resolveProviderId(
            (updates.provider_id as string | undefined) || (updates.provider as string | undefined)
          )
        : undefined;
    const resolvedFallbackProviderId =
      updates.fallback_provider_id !== undefined || updates.fallback_provider !== undefined
        ? providerManager.resolveProviderId(
            (updates.fallback_provider_id as string | undefined) ||
              (updates.fallback_provider as string | undefined)
          )
        : undefined;

    const updated: Partial<Agent> = {
      name: updates.name || existing.name,
      type: updates.type || existing.type,
      model: resolvedModel || existing.model,
      provider_id:
        updates.provider_id !== undefined || updates.provider !== undefined
          ? (resolvedProviderId ?? existing.provider_id)
          : existing.provider_id,
      fallback_provider_id:
        updates.fallback_provider_id !== undefined || updates.fallback_provider !== undefined
          ? (resolvedFallbackProviderId ?? existing.fallback_provider_id)
          : existing.fallback_provider_id,
      system_prompt:
        updates.system_prompt !== undefined ? updates.system_prompt : existing.system_prompt,
      tools: updates.tools || existing.tools,
      memory_enabled:
        updates.memory_enabled !== undefined ? updates.memory_enabled : existing.memory_enabled,
      config: updates.config || parseAgentConfig(existing.config, id),
    };

    tables.agents.update(id, updated);
    return { ...existing, ...updated } as Agent;
  }

  async start(id: string): Promise<boolean> {
    const agent = this.get(id);
    if (!agent) return false;

    const homeDir = process.env.HOME || homedir();

    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: { name: agent.name, config: agent.config as string | undefined },
      config: {},
      modelDisplay: agent.model || "MiniMax-M2.5",
      tools: this.getAgentTools(agent).map((t) => t.name),
      skills: eligibleSkills,
    });

    const runningState: RunningAgentState = {
      agent: { ...agent, system_prompt: systemPrompt },
      startedAt: new Date(),
      pid: Math.floor(Math.random() * 10000) + 1000,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ],
      lastActive: new Date(),
    };

    this.runningAgents.set(id, runningState);
    tables.agents.updateStatus(id, "running");
    console.log(`[Agent] Started agent "${agent.name}" (${id})`);
    return true;
  }

  async stop(id: string): Promise<boolean> {
    const state = this.runningAgents.get(id);
    if (!state) return false;

    const agentName = state.agent.name;
    this.runningAgents.delete(id);
    tables.agents.updateStatus(id, "stopped");
    console.log(`[Agent] Stopped agent "${agentName}" (${id})`);
    return true;
  }

  async message(id: string, content: string): Promise<{ response: string; thinking?: string }> {
    let state = this.runningAgents.get(id);
    if (!state) {
      const started = await this.start(id);
      if (started) {
        state = this.runningAgents.get(id);
      }
    }

    if (!state) {
      throw new Error("Agent is not running.");
    }

    state.lastActive = new Date();

    state.messages.push({ role: "user", content });

    const result = await this.executeWithState(state);

    state.messages.push({ role: "assistant", content: result.response });

    return result;
  }

  private async executeWithState(
    state: RunningAgentState
  ): Promise<{ response: string; thinking?: string }> {
    const { agent, messages } = state;

    const provider = this.resolveProviderForAgent(agent, true);
    if (!provider) {
      return { response: this.generateFallbackResponse(messages) };
    }

    const fullMessages = messages;

    const supportsTools = true;

    let tools: ToolDefinition[] = [];
    if (supportsTools) {
      tools = this.getAgentTools(agent);
    }

    const resolvedExecution = this.resolveProviderModelForExecution(provider, agent.model);
    const activeProvider = resolvedExecution.provider;
    const activeModel = resolvedExecution.model;

    try {
      const result = await this.callLLM(activeProvider, activeModel, fullMessages, tools);
      return { response: result.content, thinking: result.thinking };
    } catch (error) {
      console.error("[Agent] LLM call failed:", error);

      if (agent.fallback_provider_id && activeProvider.id !== agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLM(
              fallbackProvider,
              activeModel,
              fullMessages,
              tools
            );
            return { response: fallbackResult.content, thinking: fallbackResult.thinking };
          } catch (fallbackError) {
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
            return { response: this.formatLlmFailure(fallbackError) };
          }
        }
      }

      return { response: this.formatLlmFailure(error) };
    }
  }

  getHistory(id: string): AgentMessage[] {
    const state = this.runningAgents.get(id);
    if (!state) return [];
    return [...state.messages];
  }

  clearHistory(id: string): boolean {
    const state = this.runningAgents.get(id);
    if (!state) return false;

    state.messages = state.messages.filter((m) => m.role === "system");
    return true;
  }

  isRunning(id: string): boolean {
    return this.runningAgents.has(id);
  }

  getState(id: string): RunningAgentState | undefined {
    return this.runningAgents.get(id);
  }

  delete(id: string): boolean {
    this.stop(id);
    const result = tables.agents.delete(id);
    return result.changes > 0;
  }

  getRunningAgents(): Array<{
    id: string;
    name: string;
    model: string | undefined;
    pid: number;
    startedAt: string;
    messageCount: number;
    lastActive: string;
  }> {
    return Array.from(this.runningAgents.entries()).map(([id, data]) => ({
      id,
      name: data.agent.name,
      model: data.agent.model,
      pid: data.pid,
      startedAt: data.startedAt.toISOString(),
      messageCount: data.messages.length,
      lastActive: data.lastActive.toISOString(),
    }));
  }

  getStats(): { total: number; running: number; stopped: number } {
    const all = this.list();
    return {
      total: all.length,
      running: all.filter((a) => a.status === "running").length,
      stopped: all.filter((a) => a.status === "stopped").length,
    };
  }

  hasDefaultAgent(): boolean {
    const all = this.list();
    return all.some((a) => a.type === "main");
  }

  async execute(
    agentId: string,
    messages: AgentMessage[],
    options?: AgentExecutionOptions
  ): Promise<{ content: string; tool_calls?: AgentToolCallResult[] }> {
    const agent = this.get(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    let provider = this.resolveProviderForAgent(agent, true);
    if (!provider) {
      return { content: this.generateFallbackResponse(messages) };
    }

    const hasSystemMessage = messages.some((message) => message.role === "system");
    const fallbackSystemPrompt =
      typeof agent.system_prompt === "string" && agent.system_prompt.trim()
        ? agent.system_prompt
        : getDefaultSystemPrompt(agent.type || "main");

    const fullMessages = hasSystemMessage
      ? messages
      : [
          {
            role: "system" as const,
            content: fallbackSystemPrompt,
          },
          ...messages,
        ];
    const workspaceAwareMessages = this.injectWorkspaceSystemMessage(
      fullMessages,
      options?.workspaceDir
    );

    const supportsTools = true;

    const needTools = options?.useTools !== false;

    let tools: ToolDefinition[] = [];
    if (needTools) {
      if (supportsTools) {
        tools = this.getAgentTools(agent);
      } else if (agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          provider = fallbackProvider;
          tools = this.getAgentTools(agent);
        }
      }
    }

    const toolContext = this.buildToolExecutionContext(agent, options);

    const selectedModel =
      typeof options?.modelOverride === "string" && options.modelOverride.trim().length > 0
        ? options.modelOverride.trim()
        : agent.model;

    const resolvedExecution = this.resolveProviderModelForExecution(provider, selectedModel);
    const activeProvider = resolvedExecution.provider;
    const activeModel = resolvedExecution.model;

    try {
      const result = await this.callLLM(
        activeProvider,
        activeModel,
        workspaceAwareMessages,
        tools,
        toolContext
      );
      return result;
    } catch (error) {
      console.error("[Agent] LLM call failed:", error);

      if (agent.fallback_provider_id && activeProvider.id !== agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLM(
              fallbackProvider,
              activeModel,
              workspaceAwareMessages,
              tools,
              toolContext
            );
            return fallbackResult;
          } catch (fallbackError) {
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
            return { content: this.formatLlmFailure(fallbackError) };
          }
        }
      }

      return { content: this.formatLlmFailure(error) };
    }
  }

  private getAgentTools(agent: Agent): ToolDefinition[] {
    const filterEnabledTools = (tools: ToolDefinition[]): ToolDefinition[] =>
      tools.filter((tool) => isToolEnabledForAgent(tool.name));

    if (agent.tools) {
      if (Array.isArray(agent.tools)) {
        return filterEnabledTools(agent.tools);
      }
      if (typeof agent.tools === "string") {
        try {
          const parsed = JSON.parse(agent.tools);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return filterEnabledTools(parsed as ToolDefinition[]);
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }
    return filterEnabledTools(getBuiltinTools());
  }

  private getAgentToolPermissions(agent: Agent): {
    permissions: string[];
    enforcePermissions: boolean;
  } {
    const parsedConfig = parseAgentConfig(agent.config, agent.id);
    const explicitPermissions = normalizePermissionList(
      parsedConfig.tool_permissions ?? parsedConfig.toolPermissions
    );
    const enforceExplicit =
      parsedConfig.enforce_tool_permissions === true ||
      parsedConfig.enforceToolPermissions === true;

    if (explicitPermissions.length > 0) {
      return { permissions: explicitPermissions, enforcePermissions: true };
    }

    if (enforceExplicit) {
      return { permissions: [], enforcePermissions: true };
    }

    return { permissions: [], enforcePermissions: false };
  }

  private buildToolExecutionContext(agent: Agent, options?: AgentExecutionOptions): ToolContext {
    const permissions = this.getAgentToolPermissions(agent);
    return {
      agentId: agent.id,
      sessionId: options?.sessionId,
      workspaceDir: options?.workspaceDir,
      channel: options?.channel,
      userId: options?.userId,
      permissions: permissions.permissions,
      enforcePermissions: permissions.enforcePermissions,
      requireToolUse: options?.requireToolUse === true,
    };
  }

  private injectWorkspaceSystemMessage(
    messages: AgentMessage[],
    workspaceDir?: string
  ): AgentMessage[] {
    if (!workspaceDir || !workspaceDir.trim()) {
      return messages;
    }

    const workspaceInstruction =
      `Session workspace directory: ${workspaceDir}\n` +
      "Use this directory as the default root for file/process/git tools unless the user explicitly asks for another path.";

    const hasWorkspaceSystemMessage = messages.some(
      (message) =>
        message.role === "system" && message.content.includes("Session workspace directory:")
    );
    if (hasWorkspaceSystemMessage) {
      return messages;
    }

    return [
      {
        role: "system",
        content: workspaceInstruction,
      },
      ...messages,
    ];
  }

  private resolveModelParams(toolContext?: ToolContext): Record<string, unknown> {
    const agentId = toolContext?.agentId;
    if (!agentId) return {};

    const agent = this.get(agentId);
    if (!agent) return {};

    const parsedConfig = parseAgentConfig(agent.config, agent.id);
    return parseModelParams(parsedConfig.model_params ?? parsedConfig.modelParams);
  }

  private parsePositiveInt(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }

  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
      return undefined;
    }
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
    return undefined;
  }

  private clampPositiveInt(value: number, max: number): number {
    return Math.min(max, Math.max(1, value));
  }

  private resolveAgenticLoopPolicy(toolContext?: ToolContext): AgenticLoopPolicy {
    const clampIterations = (value: number) =>
      this.clampPositiveInt(value, MAX_AGENTIC_CONFIGURED_ITERATIONS);
    const clampRuntimeMs = (value: number) =>
      this.clampPositiveInt(value, MAX_AGENTIC_MAX_RUNTIME_MS);
    const clampThreshold = (value: number) => this.clampPositiveInt(value, 1000);

    const modelParams = this.resolveModelParams(toolContext);

    const agentId = toolContext?.agentId;
    const agent = agentId ? this.get(agentId) : undefined;
    const parsedConfig = agent ? parseAgentConfig(agent.config, agent.id) : {};
    const toolsConfig =
      parsedConfig.tools &&
      typeof parsedConfig.tools === "object" &&
      !Array.isArray(parsedConfig.tools)
        ? (parsedConfig.tools as Record<string, unknown>)
        : {};
    const loopDetectionConfig =
      toolsConfig.loopDetection &&
      typeof toolsConfig.loopDetection === "object" &&
      !Array.isArray(toolsConfig.loopDetection)
        ? (toolsConfig.loopDetection as Record<string, unknown>)
        : {};

    const modelParamIterations = this.parsePositiveInt(
      modelParams.max_tool_iterations ??
        modelParams.maxToolIterations ??
        modelParams.tool_loop_iterations ??
        modelParams.toolLoopIterations ??
        modelParams.max_iterations ??
        modelParams.maxIterations
    );
    const configIterations = this.parsePositiveInt(
      parsedConfig.max_tool_iterations ??
        parsedConfig.maxToolIterations ??
        parsedConfig.tool_loop_iterations ??
        parsedConfig.toolLoopIterations ??
        parsedConfig.max_agentic_iterations ??
        parsedConfig.maxAgenticIterations
    );
    const envIterations = this.parsePositiveInt(process.env.CYBARA_AGENTIC_MAX_ITERATIONS);
    const modelRuntimeMs = this.parsePositiveInt(
      modelParams.max_tool_runtime_ms ??
        modelParams.maxToolRuntimeMs ??
        modelParams.max_agentic_runtime_ms ??
        modelParams.maxAgenticRuntimeMs ??
        modelParams.tool_loop_runtime_ms ??
        modelParams.toolLoopRuntimeMs ??
        modelParams.agentic_timeout_ms ??
        modelParams.agenticTimeoutMs
    );
    const modelRuntimeSeconds = this.parsePositiveInt(
      modelParams.max_tool_runtime_seconds ??
        modelParams.maxToolRuntimeSeconds ??
        modelParams.max_agentic_runtime_seconds ??
        modelParams.maxAgenticRuntimeSeconds ??
        modelParams.tool_loop_runtime_seconds ??
        modelParams.toolLoopRuntimeSeconds ??
        modelParams.agentic_timeout_seconds ??
        modelParams.agenticTimeoutSeconds
    );
    const configRuntimeMs = this.parsePositiveInt(
      parsedConfig.max_tool_runtime_ms ??
        parsedConfig.maxToolRuntimeMs ??
        parsedConfig.max_agentic_runtime_ms ??
        parsedConfig.maxAgenticRuntimeMs ??
        parsedConfig.tool_loop_runtime_ms ??
        parsedConfig.toolLoopRuntimeMs ??
        parsedConfig.agentic_timeout_ms ??
        parsedConfig.agenticTimeoutMs
    );
    const configRuntimeSeconds = this.parsePositiveInt(
      parsedConfig.max_tool_runtime_seconds ??
        parsedConfig.maxToolRuntimeSeconds ??
        parsedConfig.max_agentic_runtime_seconds ??
        parsedConfig.maxAgenticRuntimeSeconds ??
        parsedConfig.tool_loop_runtime_seconds ??
        parsedConfig.toolLoopRuntimeSeconds ??
        parsedConfig.agentic_timeout_seconds ??
        parsedConfig.agenticTimeoutSeconds
    );
    const envRuntimeMs = this.parsePositiveInt(process.env.CYBARA_AGENTIC_MAX_RUNTIME_MS);
    const envRuntimeSeconds = this.parsePositiveInt(process.env.CYBARA_AGENTIC_MAX_RUNTIME_SECONDS);

    const warningThresholdValue = this.parsePositiveInt(
      modelParams.tool_loop_warning_threshold ??
        modelParams.toolLoopWarningThreshold ??
        modelParams.loop_warning_threshold ??
        modelParams.loopWarningThreshold ??
        parsedConfig.tool_loop_warning_threshold ??
        parsedConfig.toolLoopWarningThreshold ??
        loopDetectionConfig.warningThreshold ??
        process.env.CYBARA_TOOL_LOOP_WARNING_THRESHOLD
    );
    const criticalThresholdValue = this.parsePositiveInt(
      modelParams.tool_loop_critical_threshold ??
        modelParams.toolLoopCriticalThreshold ??
        modelParams.loop_critical_threshold ??
        modelParams.loopCriticalThreshold ??
        parsedConfig.tool_loop_critical_threshold ??
        parsedConfig.toolLoopCriticalThreshold ??
        loopDetectionConfig.criticalThreshold ??
        process.env.CYBARA_TOOL_LOOP_CRITICAL_THRESHOLD
    );
    const globalCircuitBreakerValue = this.parsePositiveInt(
      modelParams.tool_loop_global_circuit_breaker_threshold ??
        modelParams.toolLoopGlobalCircuitBreakerThreshold ??
        modelParams.loop_global_circuit_breaker_threshold ??
        modelParams.loopGlobalCircuitBreakerThreshold ??
        parsedConfig.tool_loop_global_circuit_breaker_threshold ??
        parsedConfig.toolLoopGlobalCircuitBreakerThreshold ??
        loopDetectionConfig.globalCircuitBreakerThreshold ??
        process.env.CYBARA_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD
    );
    const loopDetectionEnabled = this.parseBoolean(
      modelParams.tool_loop_detection_enabled ??
        modelParams.toolLoopDetectionEnabled ??
        modelParams.loop_detection_enabled ??
        modelParams.loopDetectionEnabled ??
        parsedConfig.tool_loop_detection_enabled ??
        parsedConfig.toolLoopDetectionEnabled ??
        loopDetectionConfig.enabled ??
        process.env.CYBARA_TOOL_LOOP_DETECTION_ENABLED
    );

    const warningThreshold = clampThreshold(
      warningThresholdValue ?? DEFAULT_TOOL_LOOP_WARNING_THRESHOLD
    );
    let criticalThreshold = clampThreshold(
      criticalThresholdValue ?? DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD
    );
    let globalCircuitBreakerThreshold = clampThreshold(
      globalCircuitBreakerValue ?? DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD
    );

    if (criticalThreshold <= warningThreshold) {
      criticalThreshold = warningThreshold + 1;
    }
    if (globalCircuitBreakerThreshold <= criticalThreshold) {
      globalCircuitBreakerThreshold = criticalThreshold + 1;
    }

    const maxIterationsRaw = modelParamIterations ?? configIterations ?? envIterations;
    const maxIterations = maxIterationsRaw ? clampIterations(maxIterationsRaw) : undefined;

    const maxRuntimeMsRaw =
      modelRuntimeMs ??
      (modelRuntimeSeconds ? modelRuntimeSeconds * 1000 : undefined) ??
      configRuntimeMs ??
      (configRuntimeSeconds ? configRuntimeSeconds * 1000 : undefined) ??
      envRuntimeMs ??
      (envRuntimeSeconds ? envRuntimeSeconds * 1000 : undefined);
    const maxRuntimeMs =
      typeof maxRuntimeMsRaw === "number" ? clampRuntimeMs(maxRuntimeMsRaw) : undefined;

    return {
      maxIterations,
      maxRuntimeMs,
      loopDetectionEnabled: loopDetectionEnabled ?? false,
      warningThreshold,
      criticalThreshold,
      globalCircuitBreakerThreshold,
    };
  }

  private updateNoProgressLoopState(
    loopState: AgenticLoopState,
    iterationToolCalls: AgentToolCallResult[]
  ): number {
    if (iterationToolCalls.length === 0) {
      loopState.previousFingerprint = undefined;
      loopState.noProgressStreak = 0;
      loopState.warningBucket = -1;
      return 0;
    }

    const iterationFingerprint = buildToolIterationFingerprint(iterationToolCalls);
    if (!iterationFingerprint) {
      loopState.previousFingerprint = undefined;
      loopState.noProgressStreak = 0;
      loopState.warningBucket = -1;
      return 0;
    }

    if (iterationFingerprint === loopState.previousFingerprint) {
      loopState.noProgressStreak += 1;
    } else {
      loopState.noProgressStreak = 1;
      loopState.warningBucket = -1;
    }
    loopState.previousFingerprint = iterationFingerprint;
    return loopState.noProgressStreak;
  }

  private evaluateNoProgressLoop(
    providerLabel: string,
    noProgressStreak: number,
    loopState: AgenticLoopState,
    loopPolicy: AgenticLoopPolicy
  ): { stop: boolean; message?: string } {
    if (!loopPolicy.loopDetectionEnabled) {
      return { stop: false };
    }
    if (noProgressStreak <= 0) {
      return { stop: false };
    }

    if (noProgressStreak >= loopPolicy.globalCircuitBreakerThreshold) {
      console.warn(
        `[Agent] ${providerLabel} tool loop global circuit breaker triggered (${noProgressStreak} repeated no-progress iterations); stopping early`
      );
      return {
        stop: true,
        message:
          "I stopped because tool calls were repeating with no progress and hit the global loop circuit breaker. Please refine the request and try again.",
      };
    }

    if (noProgressStreak >= loopPolicy.criticalThreshold) {
      console.warn(
        `[Agent] ${providerLabel} tool loop reached critical no-progress threshold (${noProgressStreak} iterations); stopping early`
      );
      return {
        stop: true,
        message:
          "I stopped because tool calls were repeating with no progress. Please refine the request and try again.",
      };
    }

    if (noProgressStreak >= loopPolicy.warningThreshold) {
      const warningBucket = Math.floor(noProgressStreak / LOOP_WARNING_BUCKET_SIZE);
      if (warningBucket > loopState.warningBucket) {
        loopState.warningBucket = warningBucket;
        console.warn(
          `[Agent] ${providerLabel} tool loop warning: ${noProgressStreak} repeated no-progress iterations`
        );
      }
    }

    return { stop: false };
  }

  private resolveAgenticLoopLimit(
    loopPolicy: AgenticLoopPolicy,
    iterations: number,
    loopStartedAt: number
  ): "maxIterations" | "runtime" | undefined {
    if (typeof loopPolicy.maxIterations === "number" && iterations >= loopPolicy.maxIterations) {
      return "maxIterations";
    }
    if (
      typeof loopPolicy.maxRuntimeMs === "number" &&
      Date.now() - loopStartedAt >= loopPolicy.maxRuntimeMs
    ) {
      return "runtime";
    }
    return undefined;
  }

  private formatRuntimeLimitLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "unknown";
    const totalSeconds = Math.max(1, Math.round(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
  }

  private applyAgenticLoopLimitMessage(
    providerLabel: string,
    limitReason: "maxIterations" | "runtime",
    loopPolicy: AgenticLoopPolicy,
    finalContent: string
  ): string {
    if (limitReason === "maxIterations") {
      console.log(
        `[Agent] ${providerLabel} agentic loop reached configured max iterations (${loopPolicy.maxIterations})`
      );
      if (!finalContent.trim()) {
        return `I reached the configured tool-iteration limit (${loopPolicy.maxIterations}) for this turn. Ask me to continue and I'll resume from here.`;
      }
      return finalContent;
    }

    console.log(
      `[Agent] ${providerLabel} agentic loop reached runtime limit (${this.formatRuntimeLimitLabel(
        loopPolicy.maxRuntimeMs ?? 0
      )})`
    );
    if (!finalContent.trim()) {
      return `I reached the tool-loop runtime limit (${this.formatRuntimeLimitLabel(
        loopPolicy.maxRuntimeMs ?? 0
      )}) for this turn. Ask me to continue and I'll resume from here.`;
    }
    return finalContent;
  }

  private mergeHeaderToken(existing: string | undefined, token: string): string {
    const normalized = (existing || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!normalized.includes(token)) {
      normalized.push(token);
    }
    return normalized.join(", ");
  }

  private buildHookContext(
    provider: string | undefined,
    model: string | undefined,
    toolContext?: ToolContext
  ): AgentHookContext {
    return {
      agentId: toolContext?.agentId,
      sessionId: toolContext?.sessionId,
      channel: toolContext?.channel,
      userId: toolContext?.userId,
      provider,
      model,
    };
  }

  private buildStatusPayload(
    status: AgentStatus,
    toolContext?: ToolContext,
    detail?: string,
    extra?: Partial<StatusPayload>
  ): StatusPayload {
    const payload: StatusPayload = {
      status,
      timestamp: Date.now(),
      detail,
      sessionId: toolContext?.sessionId,
      agentId: toolContext?.agentId,
    };

    if (extra) {
      Object.assign(payload, extra);
    }

    return payload;
  }

  private broadcastAgentStatus(
    status: AgentStatus,
    toolContext?: ToolContext,
    detail?: string,
    extra?: Partial<StatusPayload>
  ): void {
    broadcastStatus(this.buildStatusPayload(status, toolContext, detail, extra));
  }

  private normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
  }

  private async executeToolWithHooks(
    toolName: string,
    args: Record<string, unknown>,
    allowedToolNames: Set<string>,
    toolContext: ToolContext | undefined,
    hookContext: AgentHookContext
  ): Promise<{ skipped: boolean; result?: unknown }> {
    if (!hasTool(toolName)) {
      const reason = `Tool not found: ${toolName}`;
      await emitAgentHook({
        type: "tool_blocked",
        context: hookContext,
        toolName,
        args,
        reason,
      });
      return { skipped: false, result: { error: reason } };
    }

    if (!allowedToolNames.has(toolName)) {
      const reason = `Tool not enabled for this agent: ${toolName}`;
      await emitAgentHook({
        type: "tool_blocked",
        context: hookContext,
        toolName,
        args,
        reason,
      });
      return { skipped: false, result: { error: reason } };
    }

    const hookDecision = await emitAgentHook({
      type: "tool_before",
      context: hookContext,
      toolName,
      args,
    });
    if (hookDecision?.block) {
      const reason = hookDecision.reason || `Tool blocked by hook: ${toolName}`;
      await emitAgentHook({
        type: "tool_blocked",
        context: hookContext,
        toolName,
        args,
        reason,
      });
      return { skipped: false, result: { error: reason } };
    }

    try {
      const startedAt = Date.now();
      this.broadcastAgentStatus(
        "tool_executing",
        toolContext,
        formatToolActivityDetail(toolName, args, "start"),
        {
          toolName,
          toolPhase: "start",
        }
      );
      const result = await executeTool(toolName, args, toolContext);
      this.broadcastAgentStatus(
        "tool_completed",
        toolContext,
        formatToolActivityDetail(toolName, args, "result", result),
        {
          toolName,
          toolPhase: "result",
          durationMs: Date.now() - startedAt,
        }
      );
      await emitAgentHook({
        type: "tool_after",
        context: hookContext,
        toolName,
        args,
        result,
      });
      return { skipped: false, result };
    } catch (error) {
      const errorMessage = this.normalizeErrorMessage(error);
      this.broadcastAgentStatus(
        "error",
        toolContext,
        formatToolActivityDetail(toolName, args, "error"),
        {
          toolName,
          toolPhase: "error",
        }
      );
      await emitAgentHook({
        type: "tool_error",
        context: hookContext,
        toolName,
        args,
        error: errorMessage,
      });
      return { skipped: false, result: { error: errorMessage } };
    }
  }

  async callLLM(
    provider: Awaited<ReturnType<typeof providerManager.get>>,
    model: string | undefined,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolContext?: ToolContext
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const providerName =
      provider && typeof provider === "object" && "provider" in provider
        ? String((provider as { provider?: unknown }).provider || "")
        : "";
    const hookContext = this.buildHookContext(providerName || undefined, model, toolContext);

    await emitAgentHook({
      type: "llm_request",
      context: hookContext,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      toolNames: tools.map((tool) => tool.name),
    });

    const startedAt = performance.now();
    try {
      const result = await this.callLLMInternal(provider, model, messages, tools, toolContext);
      await emitAgentHook({
        type: "llm_response",
        context: hookContext,
        content: result.content,
        toolNames: (result.tool_calls || []).map((toolCall) => toolCall.name),
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      await emitAgentHook({
        type: "llm_error",
        context: hookContext,
        error: this.normalizeErrorMessage(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  }

  private async callLLMInternal(
    provider: ReturnType<typeof providerManager.get>,
    model: string | undefined,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolContext?: ToolContext
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    if (!provider) {
      throw new Error("Provider not found");
    }

    const providerInfo = provider as {
      id?: string;
      provider: string;
      base_url?: string;
      api_key?: string;
      access_token?: string;
    };
    const providerConfig = providerInfo.provider;
    const baseUrl = providerInfo.base_url || this.getProviderBaseUrl(providerConfig);
    const auth = providerInfo.api_key || providerInfo.access_token;
    const providerDefinition = providerCatalog[providerConfig as ProviderType] as
      | { api?: string; headers?: Record<string, string>; authType?: string }
      | undefined;
    const providerAuthType = providerDefinition?.authType || "api_key";
    const requiresTokenAuth = providerAuthType !== "none" && providerAuthType !== "aws-sdk";

    if (requiresTokenAuth && !auth) {
      throw new Error("No API key available");
    }
    const resolvedAuth = auth || "";

    const modelId = model || this.getDefaultModel(providerConfig);
    const apiFamily = providerDefinition?.api || "openai-completions";
    const providerHeaders = providerDefinition?.headers || {};
    const customHeaders = (providerInfo as { headers?: Record<string, string> }).headers || {};
    const mergedHeaders = { ...providerHeaders, ...customHeaders };
    const modelParams = this.resolveModelParams(toolContext);
    const modelMaxOutputTokens = this.resolveModelMaxOutputTokens(
      providerConfig,
      providerInfo.id,
      modelId
    );

    if (apiFamily === "anthropic-messages") {
      return this.callAnthropicAPI(
        baseUrl,
        resolvedAuth,
        modelId,
        messages,
        tools,
        providerConfig,
        modelMaxOutputTokens,
        toolContext,
        modelParams
      );
    }

    if (apiFamily === "openai-codex-responses") {
      return this.callOpenAICodexResponses(
        baseUrl,
        resolvedAuth,
        modelId,
        messages,
        tools,
        mergedHeaders,
        providerConfig,
        toolContext
      );
    }

    if (
      apiFamily === "openai-completions" ||
      apiFamily === "openai-responses" ||
      apiFamily === "ollama" ||
      apiFamily === "github-copilot"
    ) {
      const preferMaxCompletionTokens =
        apiFamily === "openai-responses" || apiFamily === "github-copilot";
      return this.callOpenAICompatAPI(
        baseUrl,
        resolvedAuth,
        modelId,
        messages,
        tools,
        mergedHeaders,
        providerConfig,
        toolContext,
        {
          preferMaxCompletionTokens,
          maxOutputTokens: modelMaxOutputTokens,
        }
      );
    }

    if (apiFamily === "google-generative-ai") {
      return this.callGoogleGenerativeAI(
        baseUrl,
        resolvedAuth,
        providerAuthType,
        modelId,
        messages,
        tools,
        providerConfig,
        modelMaxOutputTokens,
        toolContext
      );
    }

    if (apiFamily === "bedrock-converse-stream") {
      return this.callBedrockConverse(
        modelId,
        messages,
        tools,
        providerConfig,
        modelMaxOutputTokens,
        toolContext,
        baseUrl
      );
    }

    return this.callOpenAICompatAPI(
      baseUrl,
      resolvedAuth,
      modelId,
      messages,
      tools,
      mergedHeaders,
      providerConfig,
      toolContext,
      { maxOutputTokens: modelMaxOutputTokens }
    );
  }

  private resolveModelMaxOutputTokens(
    providerConfig: string,
    providerId: string | undefined,
    modelId: string
  ): number {
    const normalizePositiveInt = (value: unknown): number | undefined => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
      return Math.max(1, Math.floor(value));
    };
    const clampToContextWindow = (
      maxTokens: number | undefined,
      contextWindow: number | undefined
    ) =>
      contextWindow
        ? Math.min(maxTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS, contextWindow)
        : maxTokens;

    const normalizedModelId = modelId.trim().toLowerCase();
    if (providerId) {
      const providerModels = providerManager.getModels(providerId) as Array<{
        model_id?: string | null;
        model_name?: string | null;
        context_window?: number | null;
        max_tokens?: number | null;
      }>;
      const providerMatch = providerModels.find((entry) => {
        const candidateIds = [entry.model_id, entry.model_name].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        );
        return candidateIds.some((value) => value.trim().toLowerCase() === normalizedModelId);
      });
      if (providerMatch) {
        const outputLimit = normalizePositiveInt(providerMatch.max_tokens);
        const contextLimit = normalizePositiveInt(providerMatch.context_window);
        const resolved = clampToContextWindow(outputLimit, contextLimit);
        if (resolved) return resolved;
      }
    }

    const staticProvider = providerCatalog[providerConfig as ProviderType];
    const staticModel = staticProvider?.models?.find(
      (entry: { id?: string }) =>
        typeof entry.id === "string" && entry.id.trim().toLowerCase() === normalizedModelId
    ) as { maxTokens?: number; context?: number } | undefined;
    if (staticModel) {
      const outputLimit = normalizePositiveInt(staticModel.maxTokens);
      const contextLimit = normalizePositiveInt(staticModel.context);
      const resolved = clampToContextWindow(outputLimit, contextLimit);
      if (resolved) return resolved;
    }

    return DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  }

  private shouldRetryWithMaxCompletionTokens(status: number, errorText: string): boolean {
    if (status !== 400) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes("max_tokens") &&
      normalized.includes("max_completion_tokens") &&
      (normalized.includes("unsupported parameter") || normalized.includes("not supported"))
    );
  }

  private toMaxCompletionTokensRequestBody(
    requestBody: Record<string, unknown>
  ): Record<string, unknown> {
    const nextBody: Record<string, unknown> = { ...requestBody };
    const tokenLimit =
      typeof nextBody.max_tokens === "number"
        ? nextBody.max_tokens
        : typeof nextBody.max_completion_tokens === "number"
          ? nextBody.max_completion_tokens
          : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;

    delete nextBody.max_tokens;
    nextBody.max_completion_tokens = tokenLimit;
    return nextBody;
  }

  private applyOpenAITokenLimit(
    requestBody: Record<string, unknown>,
    preferMaxCompletionTokens: boolean,
    maxOutputTokens: number
  ): void {
    const tokenLimit =
      Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
        ? Math.floor(maxOutputTokens)
        : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
    if (preferMaxCompletionTokens) {
      requestBody.max_completion_tokens = tokenLimit;
      return;
    }
    requestBody.max_tokens = tokenLimit;
  }

  private async postOpenAIChatCompletions(
    baseUrl: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    errorPrefix: string
  ): Promise<OpenAIResponse> {
    const post = async (body: Record<string, unknown>) =>
      await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

    const response = await post(requestBody);
    if (response.ok) {
      return (await response.json()) as OpenAIResponse;
    }

    const errorText = await response.text();
    if (this.shouldRetryWithMaxCompletionTokens(response.status, errorText)) {
      console.log("[Agent] Retrying OpenAI request with max_completion_tokens");
      const retryBody = this.toMaxCompletionTokensRequestBody(requestBody);
      const retryResponse = await post(retryBody);
      if (retryResponse.ok) {
        return (await retryResponse.json()) as OpenAIResponse;
      }
      const retryErrorText = await retryResponse.text();
      throw new Error(`${errorPrefix}: ${retryResponse.status} - ${retryErrorText}`);
    }

    throw new Error(`${errorPrefix}: ${response.status} - ${errorText}`);
  }

  private async callOpenAICompatAPI(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    customHeaders?: Record<string, string>,
    providerConfig?: string,
    toolContext?: ToolContext,
    options?: { preferMaxCompletionTokens?: boolean; maxOutputTokens?: number }
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const preferMaxCompletionTokens = options?.preferMaxCompletionTokens === true;
    const maxOutputTokens =
      typeof options?.maxOutputTokens === "number" && Number.isFinite(options.maxOutputTokens)
        ? options.maxOutputTokens
        : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    this.applyOpenAITokenLimit(requestBody, preferMaxCompletionTokens, maxOutputTokens);

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description || "",
          parameters: t.input_schema || { type: "object", properties: {} },
        },
      }));
      if (toolContext?.requireToolUse === true) {
        requestBody.tool_choice = "required";
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders, // Merge custom headers (e.g., User-Agent for Kimi Code)
    };
    if (auth) {
      headers.Authorization = `Bearer ${auth}`;
    }

    console.log(`[Agent] Sending request with headers:`, JSON.stringify(Object.keys(headers)));

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const startTime = performance.now();

    const data = await this.postOpenAIChatCompletions(baseUrl, headers, requestBody, "API error");

    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    if (data.usage) {
      const inputTokens = data.usage.prompt_tokens || 0;
      const outputTokens = data.usage.completion_tokens || 0;
      trackTokenUsage(
        modelId,
        providerConfig || "openai-compat",
        baseUrl,
        inputTokens,
        outputTokens,
        durationMs
      );
    }

    if (!message) {
      throw new Error("No response from API");
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    const currentMessages: Record<string, unknown>[] = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const allToolCalls: AgentToolCallResult[] = [];
    let finalContent = message.content || "";
    let lastProgressThought = "";
    const hookContext = this.buildHookContext(providerConfig, modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(message.content);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      console.log(
        `[Agent] Agentic loop iteration ${iterations}: ${message.tool_calls.length} tool calls`
      );

      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];
      const iterationToolCalls: AgentToolCallResult[] = [];

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function?.name;
        const toolCallId = toolCall.id;
        const args = parseToolArguments(toolCall.function?.arguments);

        if (!toolName) continue;
        const executed = await this.executeToolWithHooks(
          toolName,
          args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        if (executed.skipped || executed.result === undefined) {
          continue;
        }

        const toolCallRecord = { name: toolName, args, result: executed.result };
        allToolCalls.push(toolCallRecord);
        iterationToolCalls.push(toolCallRecord);
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: JSON.stringify(executed.result),
        });
      }

      if (iterationToolCalls.length === 0) {
        console.warn("[Agent] Tool loop produced no tool results; stopping loop early");
        break;
      }

      const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = this.evaluateNoProgressLoop(
        providerConfig || "openai-compat",
        noProgressStreak,
        loopState,
        loopPolicy
      );
      if (loopEvaluation.stop) {
        if (!finalContent.trim()) {
          finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
        }
        break;
      }

      currentMessages.push(toOpenAIReplayAssistantMessage(message));
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
      };
      this.applyOpenAITokenLimit(loopRequestBody, preferMaxCompletionTokens, maxOutputTokens);

      if (tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.input_schema || { type: "object", properties: {} },
          },
        }));
      }

      const loopData = await this.postOpenAIChatCompletions(
        baseUrl,
        headers,
        loopRequestBody,
        "API error in agentic loop"
      );
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        break;
      }

      if (message.content) {
        finalContent = message.content;
      }
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        providerConfig || "openai-compat",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private resolveOpenAICodexBaseUrl(baseUrl: string): string {
    const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "https://chatgpt.com/backend-api";
    if (trimmed.includes("api.openai.com")) return "https://chatgpt.com/backend-api";
    return trimmed;
  }

  private resolveOpenAICodexResponsesUrl(baseUrl: string): string {
    const normalized = this.resolveOpenAICodexBaseUrl(baseUrl).replace(/\/+$/, "");
    if (normalized.endsWith("/codex/responses")) return normalized;
    if (normalized.endsWith("/codex")) return `${normalized}/responses`;
    return `${normalized}/codex/responses`;
  }

  private getOpenAICodexModelCandidates(modelId: string): string[] {
    const normalized = modelId.trim().toLowerCase();
    const candidates: string[] = [modelId];

    if (normalized === "gpt-5-codex") {
      candidates.push("gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2");
    } else if (normalized === "gpt-5.3-codex-spark") {
      candidates.push("gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2");
    } else if (normalized === "gpt-5.3-codex") {
      candidates.push("gpt-5.2-codex", "gpt-5.2");
    } else if (normalized === "gpt-5.2-codex") {
      candidates.push("gpt-5.2");
    }

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = candidate.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private shouldRetryOpenAICodexModel(status: number, errorText: string): boolean {
    if (status !== 404) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes("model_not_found") ||
      normalized.includes("does not exist") ||
      normalized.includes("no access to this model")
    );
  }

  private extractOpenAICodexAccountId(token: string): string | undefined {
    const trimmed = token.trim();
    if (!trimmed) return undefined;
    const parts = trimmed.split(".");
    if (parts.length !== 3) return undefined;
    try {
      const payloadPart = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
      const payload = JSON.parse(Buffer.from(payloadPart, "base64").toString("utf8")) as Record<
        string,
        unknown
      >;
      const authClaim = payload[OPENAI_CODEX_JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
      const accountId = authClaim?.chatgpt_account_id;
      if (typeof accountId === "string" && accountId.trim().length > 0) {
        return accountId.trim();
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private buildOpenAICodexInputFromMessages(messages: AgentMessage[]): {
    instructions?: string;
    input: Array<Record<string, unknown>>;
  } {
    const systemMessage = messages.find((message) => message.role === "system");
    const input: Array<Record<string, unknown>> = [];

    for (const message of messages) {
      if (message.role === "system") continue;

      if (message.role === "user") {
        input.push({
          role: "user",
          content: [{ type: "input_text", text: message.content }],
        });
        continue;
      }

      if (message.role === "assistant") {
        if (message.content.trim().length > 0) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: message.content }],
            status: "completed",
          });
        }
        for (const toolCall of message.tool_calls || []) {
          input.push({
            type: "function_call",
            id: toolCall.id.split("|")[1] || toolCall.id,
            call_id: toolCall.id.split("|")[0] || toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments || {}),
          });
        }
        continue;
      }

      if (message.role === "tool") {
        const rawToolCallId = message.tool_call_id || "";
        const callId =
          rawToolCallId.split("|")[0] || rawToolCallId || `call_${crypto.randomUUID()}`;
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: message.content || "{}",
        });
      }
    }

    return {
      instructions: systemMessage?.content,
      input,
    };
  }

  private buildOpenAICodexToolDefinitions(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema || { type: "object", properties: {} },
    }));
  }

  private async parseOpenAICodexTurnResponse(response: Response): Promise<OpenAICodexTurnResult> {
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";

    if (contentType.includes("application/json")) {
      const json = (await response.json()) as Record<string, unknown>;
      const choice = (json.choices as OpenAIChoice[] | undefined)?.[0];
      if (choice?.message) {
        return {
          content: choice.message.content || "",
          toolCalls: (choice.message.tool_calls || []).map((toolCall) => ({
            id: toolCall.id,
            callId: toolCall.id.split("|")[0] || toolCall.id,
            itemId: toolCall.id.split("|")[1] || undefined,
            name: toolCall.function?.name || "",
            args: parseToolArguments(toolCall.function?.arguments),
          })),
          usage: json.usage
            ? {
                inputTokens: Number((json.usage as OpenAIUsage).prompt_tokens || 0),
                outputTokens: Number((json.usage as OpenAIUsage).completion_tokens || 0),
              }
            : undefined,
        };
      }
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    let outputText = "";
    let usage: OpenAICodexUsage | undefined;
    let activeToolCallKey: string | undefined;
    const toolCalls = new Map<
      string,
      {
        callId: string;
        itemId?: string;
        name: string;
        argsJson: string;
      }
    >();

    const findToolCallKeyByItemId = (itemId: string): string | undefined => {
      for (const [key, value] of toolCalls.entries()) {
        if (value.itemId === itemId) return key;
      }
      return undefined;
    };

    for await (const event of parseServerSentEvents(response.body)) {
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "response.output_text.delta") {
        if (typeof event.delta === "string") {
          outputText += event.delta;
        }
        continue;
      }

      if (type === "response.output_item.added") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          const callId =
            typeof item.call_id === "string" && item.call_id.trim().length > 0
              ? item.call_id
              : `call_${crypto.randomUUID()}`;
          const itemId =
            typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : undefined;
          const key = `${callId}|${itemId || callId}`;
          toolCalls.set(key, {
            callId,
            itemId,
            name: typeof item.name === "string" ? item.name : "",
            argsJson: typeof item.arguments === "string" ? item.arguments : "",
          });
          activeToolCallKey = key;
        }
        continue;
      }

      if (type === "response.function_call_arguments.delta") {
        const itemId =
          typeof event.item_id === "string" && event.item_id.trim().length > 0
            ? event.item_id.trim()
            : undefined;
        const key = (itemId && findToolCallKeyByItemId(itemId)) || activeToolCallKey;
        if (key && typeof event.delta === "string") {
          const existing = toolCalls.get(key);
          if (existing) {
            existing.argsJson += event.delta;
            toolCalls.set(key, existing);
          }
        }
        continue;
      }

      if (type === "response.function_call_arguments.done") {
        const itemId =
          typeof event.item_id === "string" && event.item_id.trim().length > 0
            ? event.item_id.trim()
            : undefined;
        const key = (itemId && findToolCallKeyByItemId(itemId)) || activeToolCallKey;
        if (key && typeof event.arguments === "string") {
          const existing = toolCalls.get(key);
          if (existing) {
            existing.argsJson = event.arguments;
            toolCalls.set(key, existing);
          }
        }
        continue;
      }

      if (type === "response.output_item.done") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "message" && outputText.trim().length === 0) {
          const contentBlocks = Array.isArray(item.content)
            ? (item.content as Array<Record<string, unknown>>)
            : [];
          const text = contentBlocks
            .map((block) => {
              if (block.type === "output_text" && typeof block.text === "string") return block.text;
              if (block.type === "refusal" && typeof block.refusal === "string")
                return block.refusal;
              return "";
            })
            .filter((entry) => entry.length > 0)
            .join("");
          if (text) {
            outputText = text;
          }
        }
        if (item?.type === "function_call") {
          const callId =
            typeof item.call_id === "string" && item.call_id.trim().length > 0
              ? item.call_id
              : `call_${crypto.randomUUID()}`;
          const itemId =
            typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : undefined;
          const key = `${callId}|${itemId || callId}`;
          const existing = toolCalls.get(key);
          toolCalls.set(key, {
            callId,
            itemId,
            name:
              (existing?.name && existing.name.trim().length > 0
                ? existing.name
                : typeof item.name === "string"
                  ? item.name
                  : "") || "",
            argsJson:
              (typeof item.arguments === "string" && item.arguments) || existing?.argsJson || "{}",
          });
          activeToolCallKey = undefined;
        }
        continue;
      }

      if (type === "response.completed") {
        const completed = event.response as Record<string, unknown> | undefined;
        const usageObj = completed?.usage as Record<string, unknown> | undefined;
        if (usageObj) {
          const inputTokens =
            typeof usageObj.input_tokens === "number" && Number.isFinite(usageObj.input_tokens)
              ? Math.floor(usageObj.input_tokens)
              : 0;
          const outputTokens =
            typeof usageObj.output_tokens === "number" && Number.isFinite(usageObj.output_tokens)
              ? Math.floor(usageObj.output_tokens)
              : 0;
          usage = { inputTokens, outputTokens };
        }
        continue;
      }

      if (type === "response.failed") {
        const failed = event.response as Record<string, unknown> | undefined;
        const failedError = failed?.error as Record<string, unknown> | undefined;
        const message =
          (typeof failedError?.message === "string" && failedError.message) ||
          "OpenAI Codex response failed";
        throw new Error(message);
      }

      if (type === "error") {
        const message =
          (typeof event.message === "string" && event.message) || "OpenAI Codex stream error";
        throw new Error(message);
      }
    }

    return {
      content: outputText.trim(),
      toolCalls: Array.from(toolCalls.entries())
        .map(([key, value]) => ({
          id: key,
          callId: value.callId,
          itemId: value.itemId,
          name: value.name,
          args: parseToolArguments(value.argsJson || "{}"),
        }))
        .filter((toolCall) => toolCall.name.trim().length > 0),
      usage,
    };
  }

  private async postOpenAICodexTurn(
    url: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    requestedModel: string
  ): Promise<OpenAICodexTurnResult & { resolvedModel: string }> {
    const candidates = this.getOpenAICodexModelCandidates(requestedModel);
    let finalError = "OpenAI Codex request failed";

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const body = { ...requestBody, model: candidate };
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        finalError = `API error: ${response.status} - ${errorText}`;
        if (
          index < candidates.length - 1 &&
          this.shouldRetryOpenAICodexModel(response.status, errorText)
        ) {
          console.warn(
            `[Agent] OpenAI Codex model ${candidate} unavailable, retrying with ${candidates[index + 1]}`
          );
          continue;
        }
        throw new Error(finalError);
      }

      const parsed = await this.parseOpenAICodexTurnResponse(response);
      return { ...parsed, resolvedModel: candidate };
    }

    throw new Error(finalError);
  }

  private async callOpenAICodexResponses(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    customHeaders?: Record<string, string>,
    providerConfig?: string,
    toolContext?: ToolContext
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const codexUrl = this.resolveOpenAICodexResponsesUrl(baseUrl);
    const { instructions, input } = this.buildOpenAICodexInputFromMessages(messages);
    const inputItems: Array<Record<string, unknown>> = [...input];
    const toolDefinitions = this.buildOpenAICodexToolDefinitions(tools);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...customHeaders,
    };
    if (auth) {
      headers.Authorization = `Bearer ${auth}`;
    }
    const accountId = this.extractOpenAICodexAccountId(auth);
    if (accountId) {
      headers["chatgpt-account-id"] = accountId;
    }
    if (!headers["OpenAI-Beta"] && !headers["openai-beta"]) {
      headers["OpenAI-Beta"] = "responses=experimental";
    }
    if (!headers.originator && !headers.Originator) {
      headers.originator = "cybara";
    }

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    let activeModelId = modelId;
    let finalContent = "";
    let lastProgressThought = "";
    const allToolCalls: AgentToolCallResult[] = [];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const hookContext = this.buildHookContext(providerConfig, activeModelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      const requestBody: Record<string, unknown> = {
        model: activeModelId,
        store: false,
        stream: true,
        input: inputItems,
        text: { verbosity: "medium" },
        include: ["reasoning.encrypted_content"],
        tool_choice: toolContext?.requireToolUse === true && iterations === 1 ? "required" : "auto",
        parallel_tool_calls: true,
      };
      if (instructions && instructions.trim().length > 0) {
        requestBody.instructions = instructions;
      }
      if (toolDefinitions.length > 0) {
        requestBody.tools = toolDefinitions;
      }
      if (toolContext?.sessionId) {
        requestBody.prompt_cache_key = toolContext.sessionId;
      }

      const startTime = performance.now();
      const turn = await this.postOpenAICodexTurn(codexUrl, headers, requestBody, activeModelId);
      activeModelId = turn.resolvedModel;
      const durationMs = Math.round(performance.now() - startTime);

      if (turn.usage) {
        trackTokenUsage(
          activeModelId,
          providerConfig || "openai-codex",
          codexUrl,
          turn.usage.inputTokens,
          turn.usage.outputTokens,
          durationMs
        );
      }

      if (turn.content.trim().length > 0) {
        finalContent = turn.content.trim();
      }

      if (turn.toolCalls.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(turn.content);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      const iterationToolCalls: AgentToolCallResult[] = [];
      const functionCallItems: Array<Record<string, unknown>> = [];
      const functionCallOutputs: Array<Record<string, unknown>> = [];

      if (turn.content.trim().length > 0) {
        inputItems.push({
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: turn.content }],
        });
      }

      for (const toolCall of turn.toolCalls) {
        functionCallItems.push({
          type: "function_call",
          id: toolCall.itemId || toolCall.callId,
          call_id: toolCall.callId,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.args || {}),
        });

        const executed = await this.executeToolWithHooks(
          toolCall.name,
          toolCall.args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        if (executed.skipped || executed.result === undefined) {
          continue;
        }

        const toolCallRecord = {
          name: toolCall.name,
          args: toolCall.args,
          result: executed.result,
        };
        allToolCalls.push(toolCallRecord);
        iterationToolCalls.push(toolCallRecord);
        functionCallOutputs.push({
          type: "function_call_output",
          call_id: toolCall.callId,
          output: JSON.stringify(executed.result),
        });
      }

      if (iterationToolCalls.length === 0) {
        console.warn(
          "[Agent] OpenAI Codex tool loop produced no tool results; stopping loop early"
        );
        break;
      }

      const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = this.evaluateNoProgressLoop(
        providerConfig || "openai-codex",
        noProgressStreak,
        loopState,
        loopPolicy
      );
      if (loopEvaluation.stop) {
        if (!finalContent.trim()) {
          finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
        }
        break;
      }

      inputItems.push(...functionCallItems, ...functionCallOutputs);
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        providerConfig || "openai-codex",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private async callGoogleGenerativeAI(
    baseUrl: string,
    auth: string,
    providerAuthType: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    providerConfig: string,
    maxOutputTokens: number,
    toolContext?: ToolContext
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const systemMessage = messages.find((message) => message.role === "system");
    const chatMessages = messages.filter((message) => message.role !== "system");
    const contents: GoogleContent[] = chatMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const headers = parseGoogleAuthHeaders(auth, providerAuthType).headers;
    const normalizedModelId = normalizeGoogleModelId(modelId);

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const endpoint = `${normalizedBaseUrl}/models/${encodeURIComponent(normalizedModelId)}:generateContent`;
    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    let finalContent = "";
    let lastProgressThought = "";
    const allToolCalls: AgentToolCallResult[] = [];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const hookContext = this.buildHookContext(providerConfig, modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      const requestBody: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens,
        },
      };

      if (systemMessage) {
        requestBody.systemInstruction = {
          parts: [{ text: systemMessage.content }],
        };
      }

      if (tools.length > 0) {
        requestBody.tools = [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description || "",
              parameters: tool.input_schema || { type: "object", properties: {} },
            })),
          },
        ];
      }

      const startTime = performance.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as GoogleResponse;
      const durationMs = Math.round(performance.now() - startTime);
      const usage = data.usageMetadata;
      if (usage) {
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs);
      }

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const text = parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter((entry) => entry.length > 0)
        .join("\n")
        .trim();
      if (text) {
        finalContent = text;
      }

      const toolCalls = parts
        .map((part) => part.functionCall)
        .filter(
          (
            functionCall
          ): functionCall is {
            name: string;
            args?: unknown;
          } =>
            !!functionCall && typeof functionCall.name === "string" && functionCall.name.length > 0
        );

      if (toolCalls.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(text);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      const toolResponses: GooglePart[] = [];
      const iterationToolCalls: AgentToolCallResult[] = [];
      for (const toolCall of toolCalls) {
        const args =
          toolCall.args && typeof toolCall.args === "object"
            ? (toolCall.args as Record<string, unknown>)
            : parseToolArguments(toolCall.args);
        const executed = await this.executeToolWithHooks(
          toolCall.name,
          args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        if (executed.skipped || executed.result === undefined) {
          continue;
        }

        const toolCallRecord = { name: toolCall.name, args, result: executed.result };
        allToolCalls.push(toolCallRecord);
        iterationToolCalls.push(toolCallRecord);
        const responsePayload =
          executed.result && typeof executed.result === "object"
            ? (executed.result as Record<string, unknown>)
            : { result: executed.result };
        toolResponses.push({
          functionResponse: {
            name: toolCall.name,
            response: responsePayload,
          },
        });
      }

      if (toolResponses.length === 0) {
        break;
      }

      const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = this.evaluateNoProgressLoop(
        "google",
        noProgressStreak,
        loopState,
        loopPolicy
      );
      if (loopEvaluation.stop) {
        if (!finalContent.trim()) {
          finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
        }
        break;
      }

      contents.push({
        role: "model",
        parts,
      });
      contents.push({
        role: "user",
        parts: toolResponses,
      });
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        "google",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private resolveBedrockRegion(baseUrl?: string): string {
    if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
      const match = baseUrl.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/i);
      const region = match?.[1];
      if (typeof region === "string" && region && region !== "{region}") {
        return region;
      }
    }
    return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  }

  private async callBedrockConverse(
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    providerConfig: string,
    maxOutputTokens: number,
    toolContext?: ToolContext,
    baseUrl?: string
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const region = this.resolveBedrockRegion(baseUrl);
    const client = new BedrockRuntimeClient({ region });
    const systemMessage = messages.find((message) => message.role === "system");
    const conversation: BedrockMessage[] = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: [{ text: message.content }],
      }));
    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    let finalContent = "";
    let lastProgressThought = "";
    const allToolCalls: AgentToolCallResult[] = [];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const hookContext = this.buildHookContext(providerConfig, modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      const requestPayload: ConverseCommandInput = {
        modelId,
        messages: conversation,
        inferenceConfig: {
          maxTokens: maxOutputTokens,
        },
      };

      if (systemMessage) {
        requestPayload.system = [{ text: systemMessage.content }];
      }

      if (tools.length > 0) {
        const bedrockTools = tools.map((tool) => ({
          toolSpec: {
            name: tool.name,
            description: tool.description || "",
            inputSchema: {
              json: (tool.input_schema || { type: "object", properties: {} }) as SmithyDocumentType,
            },
          },
        })) as NonNullable<ConverseCommandInput["toolConfig"]>["tools"];

        requestPayload.toolConfig = {
          tools: bedrockTools,
        };
      }

      const startTime = performance.now();
      const response = await client.send(new ConverseCommand(requestPayload));
      const durationMs = Math.round(performance.now() - startTime);
      const usage = response.usage;
      if (usage) {
        const inputTokens = usage.inputTokens || 0;
        const outputTokens = usage.outputTokens || 0;
        trackTokenUsage(
          modelId,
          providerConfig,
          baseUrl || "",
          inputTokens,
          outputTokens,
          durationMs
        );
      }

      const outputMessage = response.output?.message;
      const outputContent: BedrockContentBlock[] = outputMessage?.content || [];
      const textParts = outputContent
        .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
        .filter((text) => text.length > 0);
      const text = textParts.join("\n").trim();
      if (text) {
        finalContent = text;
      }

      const toolUseBlocks: Array<{
        toolUseId: string;
        name: string;
        input?: unknown;
      }> = outputContent
        .map((block) => ("toolUse" in block ? block.toolUse : undefined))
        .filter(
          (toolUse): toolUse is ToolUseBlock =>
            !!toolUse && typeof toolUse.name === "string" && toolUse.name.length > 0
        )
        .map((toolUse) => ({
          toolUseId: toolUse.toolUseId || "",
          name: toolUse.name as string,
          input: toolUse.input,
        }));

      if (toolUseBlocks.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(text);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      const toolResults: BedrockContentBlock[] = [];
      const iterationToolCalls: AgentToolCallResult[] = [];
      for (const toolUse of toolUseBlocks) {
        const args =
          toolUse.input && typeof toolUse.input === "object"
            ? (toolUse.input as Record<string, unknown>)
            : parseToolArguments(toolUse.input);
        const executed = await this.executeToolWithHooks(
          toolUse.name,
          args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        if (executed.skipped || executed.result === undefined) {
          continue;
        }

        const toolCallRecord = { name: toolUse.name, args, result: executed.result };
        allToolCalls.push(toolCallRecord);
        iterationToolCalls.push(toolCallRecord);
        const normalizedResult =
          executed.result && typeof executed.result === "object"
            ? (executed.result as Record<string, unknown>)
            : { result: executed.result };
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            content: [{ json: normalizedResult as SmithyDocumentType }],
          },
        });
      }

      if (toolResults.length === 0) {
        break;
      }

      const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = this.evaluateNoProgressLoop(
        "bedrock",
        noProgressStreak,
        loopState,
        loopPolicy
      );
      if (loopEvaluation.stop) {
        if (!finalContent.trim()) {
          finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
        }
        break;
      }

      conversation.push({
        role: "assistant",
        content: outputContent,
      });
      conversation.push({
        role: "user",
        content: toolResults,
      });
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        "bedrock",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private async callAnthropicAPI(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    providerConfig: string,
    maxOutputTokens: number,
    toolContext?: ToolContext,
    modelParams?: Record<string, unknown>
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: chatMessages,
      max_tokens: maxOutputTokens,
    };

    if (systemMessage) {
      requestBody.system = systemMessage.content;
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.input_schema || { type: "object", properties: {} },
      }));
      requestBody.tool_choice = { type: "auto" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": auth,
      "anthropic-version": "2023-06-01",
    };

    if (modelParams?.context1m === true) {
      headers["anthropic-beta"] = this.mergeHeaderToken(
        headers["anthropic-beta"],
        ANTHROPIC_CONTEXT_1M_BETA
      );
    }

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const startTime = performance.now();

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const durationMs = Math.round(performance.now() - startTime);

    if (data.usage) {
      const inputTokens = data.usage.input_tokens || 0;
      const outputTokens = data.usage.output_tokens || 0;
      trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs);
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    let currentData = data;

    const currentMessages: Record<string, unknown>[] = chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const allowedToolNames = new Set(tools.map((tool) => tool.name));

    const allToolCalls: AgentToolCallResult[] = [];
    let finalContent = currentData.content?.find((c) => c.type === "text")?.text || "";
    let lastProgressThought = "";
    const thinking =
      currentData.content?.find((c) => c.type === ("thinking" as string))?.text || undefined;
    const hookContext = this.buildHookContext(providerConfig, modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      const toolUseBlocks =
        (currentData.content?.filter((c: { type: string }) => c.type === "tool_use") as Array<{
          type: "tool_use";
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>) || [];

      if (toolUseBlocks.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(
        currentData.content?.find((c) => c.type === "text")?.text
      );
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      console.log(
        `[Agent] Anthropic agentic loop iteration ${iterations}: ${toolUseBlocks.length} tool calls`
      );

      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      const expectedToolUseIds = new Set<string>();
      const iterationToolCalls: AgentToolCallResult[] = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = typeof toolUse.name === "string" ? toolUse.name : "";
        const toolUseId = typeof toolUse.id === "string" ? toolUse.id : "";
        if (!toolUseId) {
          console.warn("[Agent] Anthropic tool_use missing id; skipping unmatched tool block");
          continue;
        }
        expectedToolUseIds.add(toolUseId);
        const args = toolUse.input || {};

        if (!toolName) {
          const missingNamePayload = { error: "Tool use block missing tool name" };
          iterationToolCalls.push({
            name: "__missing_tool_name__",
            args,
            result: missingNamePayload,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: JSON.stringify(missingNamePayload),
          });
          continue;
        }

        const executed = await this.executeToolWithHooks(
          toolName,
          args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        const resultPayload =
          executed.skipped || executed.result === undefined
            ? { error: `Tool execution skipped for ${toolName}` }
            : executed.result;
        iterationToolCalls.push({ name: toolName, args, result: resultPayload });
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: JSON.stringify(resultPayload),
        });
      }

      const returnedToolUseIds = new Set(toolResults.map((toolResult) => toolResult.tool_use_id));
      for (const expectedId of expectedToolUseIds) {
        if (returnedToolUseIds.has(expectedId)) continue;
        toolResults.push({
          type: "tool_result",
          tool_use_id: expectedId,
          content: JSON.stringify({ error: "Missing tool result synthesized by Cybara" }),
        });
      }

      if (toolResults.length === 0) {
        console.warn("[Agent] Anthropic tool loop produced no tool results; stopping loop early");
        break;
      }

      if (iterationToolCalls.length > 0) {
        const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
        const loopEvaluation = this.evaluateNoProgressLoop(
          "anthropic",
          noProgressStreak,
          loopState,
          loopPolicy
        );
        if (loopEvaluation.stop) {
          if (!finalContent.trim()) {
            finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
          }
          break;
        }
      }

      const toolResultIds = new Set(toolResults.map((toolResult) => toolResult.tool_use_id));
      const assistantLoopContent = (currentData.content || []).filter(
        (block: { type?: string; id?: string }) =>
          block.type !== "tool_use" || (typeof block.id === "string" && toolResultIds.has(block.id))
      );

      currentMessages.push({
        role: "assistant",
        content: assistantLoopContent,
      });
      currentMessages.push({
        role: "user",
        content: toolResults,
      });

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: maxOutputTokens,
      };

      if (systemMessage) {
        loopRequestBody.system = systemMessage.content;
      }

      if (tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          name: t.name,
          description: t.description || "",
          input_schema: t.input_schema || { type: "object", properties: {} },
        }));
      }

      const loopResponse = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(loopRequestBody),
      });

      if (!loopResponse.ok) {
        const loopError = await loopResponse.text();
        throw new Error(`API error in agentic loop: ${loopResponse.status} - ${loopError}`);
      }

      currentData = (await loopResponse.json()) as AnthropicResponse;

      const latestText = currentData.content?.find((c) => c.type === "text")?.text;
      if (latestText) {
        finalContent = latestText;
      }
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        "anthropic",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      thinking,
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private async callOpenAIAPI(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolContext?: ToolContext
  ): Promise<{ content: string; tool_calls?: AgentToolCallResult[] }> {
    const maxOutputTokens = this.resolveModelMaxOutputTokens("openai", undefined, modelId);
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    if (systemMessage) {
      chatMessages.unshift({
        role: "system",
        content: systemMessage.content,
      });
    }

    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: chatMessages,
      max_tokens: maxOutputTokens,
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description || "",
          parameters: t.input_schema || { type: "object", properties: {} },
        },
      }));
      requestBody.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth}`,
    };

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const startTime = performance.now();

    const data = await this.postOpenAIChatCompletions(baseUrl, headers, requestBody, "API error");

    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    if (data.usage) {
      const inputTokens = data.usage.prompt_tokens || 0;
      const outputTokens = data.usage.completion_tokens || 0;
      trackTokenUsage(modelId, "openai", baseUrl, inputTokens, outputTokens, durationMs);
    }

    if (!message) {
      throw new Error("No response from API");
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopStartedAt = Date.now();
    let iterations = 0;
    const currentMessages: Record<string, unknown>[] = [...chatMessages];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const allToolCalls: AgentToolCallResult[] = [];
    let finalContent = message.content || "";
    let lastProgressThought = "";
    const hookContext = this.buildHookContext("openai", modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      limitReason = this.resolveAgenticLoopLimit(loopPolicy, iterations, loopStartedAt);
      if (limitReason) {
        break;
      }
      iterations++;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(message.content);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      console.log(
        `[Agent] OpenAI agentic loop iteration ${iterations}: ${message.tool_calls.length} tool calls`
      );

      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];
      const iterationToolCalls: AgentToolCallResult[] = [];

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function?.name;
        const toolCallId = toolCall.id;
        const args = parseToolArguments(toolCall.function?.arguments);

        if (!toolName) continue;
        const executed = await this.executeToolWithHooks(
          toolName,
          args,
          allowedToolNames,
          toolContext,
          hookContext
        );
        if (executed.skipped || executed.result === undefined) {
          continue;
        }

        const toolCallRecord = { name: toolName, args, result: executed.result };
        allToolCalls.push(toolCallRecord);
        iterationToolCalls.push(toolCallRecord);
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: JSON.stringify(executed.result),
        });
      }

      if (iterationToolCalls.length === 0) {
        console.warn("[Agent] OpenAI tool loop produced no tool results; stopping loop early");
        break;
      }

      const noProgressStreak = this.updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = this.evaluateNoProgressLoop(
        "openai",
        noProgressStreak,
        loopState,
        loopPolicy
      );
      if (loopEvaluation.stop) {
        if (!finalContent.trim()) {
          finalContent = loopEvaluation.message || "I stopped due to a tool loop safety guard.";
        }
        break;
      }

      currentMessages.push(toOpenAIReplayAssistantMessage(message));
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: maxOutputTokens,
      };

      if (tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.input_schema || { type: "object", properties: {} },
          },
        }));
      }

      const loopData = await this.postOpenAIChatCompletions(
        baseUrl,
        headers,
        loopRequestBody,
        "API error in agentic loop"
      );
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        break;
      }

      if (message.content) {
        finalContent = message.content;
      }
    }

    if (limitReason) {
      finalContent = this.applyAgenticLoopLimitMessage(
        "openai",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  private getProviderBaseUrl(provider: string): string {
    return getProviderBaseUrl(provider);
  }

  private getDefaultModel(provider: string): string {
    return getDefaultModel(provider);
  }

  private generateFallbackResponse(messages: AgentMessage[]): string {
    const lastMessage = messages.filter((m) => m.role === "user").pop();
    if (!lastMessage) {
      return "Hello! How can I help you today?";
    }

    const text = lastMessage.content.toLowerCase();

    if (text.includes("hello") || text.includes("hi")) {
      return "Hello! I'm your AI assistant. How can I help you today?";
    }
    if (text.includes("time")) {
      return `The current time is ${new Date().toLocaleString()}.`;
    }
    if (text.includes("who are you")) {
      return "I'm an AI assistant powered by Cybara. I can help with various tasks including writing code, answering questions, and more.";
    }

    return "I apologize, but I encountered an issue processing your request. Please try again or rephrase your message.";
  }
}

export const agentManager = new AgentManager();
