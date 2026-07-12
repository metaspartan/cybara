import type { Agent, ToolDefinition } from "./database";
import { config } from "./config";
import {
  providerManager,
  getProviderBaseUrl,
  getDefaultModel,
  providers as providerCatalog,
  type ProviderType,
} from "./providers";
import { toolSchemas, type ToolContext } from "./tools/index";
import {
  acquireCredential,
  markCredentialCooldown,
  markCredentialHealthy,
  msUntilAnyAvailable,
  poolSize,
  type PooledCredential,
} from "./credential-pool";
import { recordRateLimit } from "./rate-limit-tracker";
import { applyAnthropicCacheControl, type AnthropicCacheRequest } from "./prompt-cache";
import {
  hasImages,
  toAnthropicImageBlock,
  toOpenAIImageBlock,
  openAIResponsesUserContent,
  bedrockUserContent,
  toGoogleImagePart,
} from "./llm/image-blocks";
import {
  normalizeReasoningEffort,
  coerceReasoningEffort,
  openAICompatReasoningParams,
  anthropicThinkingBudget,
  googleThinkingConfig,
  usesAnthropicAdaptiveThinking,
} from "./llm/reasoning";
import { applyProviderApiKey } from "./llm/auth-headers";
import { normalizeLlmTimeoutError, withLlmRequestTimeout } from "./llm/request-timeout";
import {
  createStreamWatchdog,
  resolveLlmWatchdogDefaults,
  type StreamWatchdog,
} from "./llm/stream-watchdog";
import { consumeOpenAIChatStream } from "./llm/streaming-completions";
import {
  getSessionTokenUsageSnapshot,
  trackEstimatedSessionTokenUsage,
} from "./llm/session-token-usage";
import { compactCodexInputItemsForContext, sanitizeCodexInputItems } from "./llm/codex-context";
import { recordMidLoopContextCompaction } from "./llm/context-pressure";
import {
  compactOpenAIChatTranscriptInPlace,
  compactOpenAIRequestMessagesForContext as compactOpenAIRequestMessages,
  isContextOverflowError,
  TOOL_RESULT_COMPACTION_NOTICE,
} from "./llm/tool-transcript";
import { trackTokenUsage } from "./llm/token-usage-tracking";
import { trackOpenAIResponseUsage } from "./llm/openai-response-usage";
import { formatToolResultForModel } from "./llm/model-visible-format";
import { formatRecoverableToolOutputPreview } from "./tool-output-recovery";
import { googleFunctionDeclaration } from "./llm/google-tool-schema";
import {
  hasTextToolCallMarkup,
  normalizeAnthropicToolUses,
  normalizeOpenAIToolCalls,
  sanitizeAssistantContent,
  shouldUseMiniMaxReasoningSplit,
  toAnthropicReplayContentWithNormalizedToolUses,
  toOpenAIReplayMessageWithNormalizedToolCalls,
} from "./llm/text-tool-calls";
import { canRunToolsInParallel } from "./llm/parallel-tools";
import { coalesceSystemMessages } from "./llm/system-messages";
import {
  anthropicEndpointPath,
  anthropicRequestBase,
  anthropicRequestHeaders,
} from "./llm/anthropic-vertex";
import { recordRateLimit as recordRouterRateLimit } from "./router";
import {
  executeTool,
  formatMissingRequiredToolArgumentsError,
  getMissingRequiredToolArguments,
  hasTool,
} from "./tools/handlers/index";
import { noteToolActivityForTodoReminder } from "./tools/handlers/todo";
import {
  broadcastStatus,
  broadcastTokenDelta,
  type AgentStatus,
  type StatusPayload,
} from "./status";
import {
  ANTHROPIC_CONTEXT_1M_BETA,
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  CONTEXT_INPUT_HEADROOM_RATIO,
  CONTEXT_LIMIT_TRUNCATION_NOTICE,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  HARD_MAX_TOOL_RESULT_CHARS,
  LOOP_WARNING_BUCKET_SIZE,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  MIN_TOOL_RESULT_CHARS,
  buildToolIterationFingerprint,
  extractSandboxProviderFromToolResult,
  formatToolActivityDetail,
  normalizeGoogleModelId,
  parseAgentConfig,
  parseGoogleAuthHeaders,
  parseModelParams,
  parseServerSentEvents,
  parseToolArguments,
  summarizeProgressThought,
  type AgentToolCallResult,
  type AgenticLoopPolicy,
  type AgenticLoopState,
  type AnthropicResponse,
  type GoogleContent,
  type GooglePart,
  type GoogleResponse,
  type OpenAICodexUsage,
  type OpenAICodexTurnResult,
  type OpenAIChoice,
  type OpenAIMessage,
  type OpenAIResponse,
  type OpenAIUsage,
} from "./agent-internals";
import {
  countWebResearchCalls,
  WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
  webResearchBudgetReached,
} from "./agent-web-research";
import {
  extractOpenAICodexAccountId,
  getOpenAICodexModelCandidates,
  shouldRetryOpenAICodexModel,
} from "./openai-codex-models";
import { emitAgentHook, type AgentHookContext } from "./agent-hooks";
import {
  resolveModelContextWindowTokens,
  resolveModelMaxOutputTokens,
  shouldPreferMaxCompletionTokens,
} from "./agent-model-limits";
import { coerceToolArguments } from "./tool-argument-coercion";
import { isToolPolicyBlockedMessage, sanitizeToolErrorMessage } from "./tool-result-classification";
import { resolveAgenticLoopPolicyFromConfig } from "./agent-loop-policy";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ContentBlock as BedrockContentBlock,
  type Message as BedrockMessage,
  type ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType as SmithyDocumentType } from "@smithy/types";

import type { AgentMessage } from "./agent";

const SKILL_NUDGE_TRIVIAL_TOOLS = new Set([
  "read",
  "file_search",
  "grep",
  "memory_search",
  "memory_get",
  "session_search",
  "todo",
  "clarify",
  "tool_search",
  "tool_describe",
  "workspace_index_search",
]);

function shouldNudgeSkillLearning(toolCalls: Array<{ name: string }>): boolean {
  if (config.get<boolean>("skill_learning_nudge_enabled") !== true) return false;
  if (config.get<boolean>("self_improving_skills_enabled") === false) return false;
  if (toolCalls.some((call) => call.name === "skill_save")) return false;
  const substantial = new Set(
    toolCalls.map((call) => call.name).filter((name) => !SKILL_NUDGE_TRIVIAL_TOOLS.has(name))
  );
  return substantial.size >= 4;
}

function sessionIdForVisibleTokenUsage(toolContext?: ToolContext): string | undefined {
  if (toolContext?.suppressStreaming) return undefined;
  const sessionId = typeof toolContext?.sessionId === "string" ? toolContext.sessionId.trim() : "";
  return sessionId || undefined;
}

interface ProviderRateLimitContext {
  providerId?: string;
  providerType?: string;
  defaultRetryAfterMs?: number;
}

export abstract class AgentProviderRuntime {
  protected abstract get(id: string): Agent | undefined;

  private resolveModelParams(toolContext?: ToolContext): Record<string, unknown> {
    const agentId = toolContext?.agentId;
    if (!agentId) return {};

    const agent = this.get(agentId);
    if (!agent) return {};

    const parsedConfig = parseAgentConfig(agent.config, agent.id);
    const params = parseModelParams(parsedConfig.model_params ?? parsedConfig.modelParams);
    if (params.reasoning_effort === undefined && params.reasoningEffort === undefined) {
      const globalDefault = config.getDefaultReasoningEffort();
      if (globalDefault) params.reasoning_effort = globalDefault;
    }
    return params;
  }

  private resolveAgenticLoopPolicy(toolContext?: ToolContext): AgenticLoopPolicy {
    const modelParams = this.resolveModelParams(toolContext);
    const agentId = toolContext?.agentId;
    const agent = agentId ? this.get(agentId) : undefined;
    const parsedConfig = agent ? parseAgentConfig(agent.config, agent.id) : {};
    return resolveAgenticLoopPolicyFromConfig({
      agentConfig: parsedConfig,
      env: process.env,
      modelParams,
    });
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
    if (toolContext?.suppressStreaming) return;
    broadcastStatus(this.buildStatusPayload(status, toolContext, detail, extra));
  }

  private consumeSteeringText(toolContext?: ToolContext): string | null {
    const consumed = toolContext?.consumeSteeringMessages?.() || [];
    const messages = consumed
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0);
    if (messages.length === 0) return null;

    const content =
      messages.length === 1
        ? messages[0]
        : messages.map((message, index) => `${index + 1}. ${message}`).join("\n");
    this.broadcastAgentStatus(
      "thinking",
      toolContext,
      messages.length === 1
        ? "Applying user steering..."
        : `Applying ${messages.length} user steering updates...`
    );
    return [
      "User steering update received while this response was running.",
      "Adjust the current work to account for this message before continuing.",
      content,
    ].join("\n\n");
  }

  private normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
  }

  private parseRetryAfterMs(headers: Headers, defaultRetryAfterMs = 60_000): number {
    const raw = headers.get("retry-after") || headers.get("Retry-After");
    if (!raw) return defaultRetryAfterMs;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(0, Math.floor(seconds * 1000));
    }
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return defaultRetryAfterMs;
  }

  private recordHttpRateLimit(
    status: number,
    headers: Headers,
    context?: ProviderRateLimitContext
  ): void {
    if (status !== 429) return;
    const retryAfterMs = this.parseRetryAfterMs(headers, context?.defaultRetryAfterMs);
    const keys = [context?.providerId?.trim(), context?.providerType?.trim()].filter(
      (key): key is string => Boolean(key)
    );
    for (const key of keys) {
      try {
        recordRateLimit(key, headers);
        recordRouterRateLimit(key, retryAfterMs);
      } catch {
        continue;
      }
    }
  }

  private missingExecutableToolCallsMessage(): string {
    return "I stopped because the model produced tool calls without the required arguments.";
  }

  private createToolCallStatusId(toolName: string): string {
    const normalizedToolName = toolName.trim().toLowerCase() || "tool";
    return `${normalizedToolName}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
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

    args = coerceToolArguments(toolName, args, toolSchemas[toolName]?.input_schema);

    const missingArgs = getMissingRequiredToolArguments(toolName, args);
    if (missingArgs.length > 0) {
      const reason = formatMissingRequiredToolArgumentsError(toolName, missingArgs);
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

    const toolCallId = this.createToolCallStatusId(toolName);
    try {
      const startedAt = Date.now();
      this.broadcastAgentStatus(
        "tool_executing",
        toolContext,
        formatToolActivityDetail(toolName, args, "start"),
        {
          toolName,
          toolCallId,
          toolPhase: "start",
        }
      );
      const result = await executeTool(toolName, args, toolContext);
      const todoReminder = noteToolActivityForTodoReminder(toolName, toolContext);
      if (todoReminder && result && typeof result === "object" && !Array.isArray(result)) {
        (result as Record<string, unknown>).system_reminder = todoReminder;
      }
      this.broadcastAgentStatus(
        "tool_completed",
        toolContext,
        formatToolActivityDetail(toolName, args, "result", result),
        {
          toolName,
          toolCallId,
          toolPhase: "result",
          durationMs: Date.now() - startedAt,
          sandboxProvider: extractSandboxProviderFromToolResult(result),
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
      const errorMessage = sanitizeToolErrorMessage(this.normalizeErrorMessage(error));
      const blocked = isToolPolicyBlockedMessage(errorMessage);
      const phase = blocked ? "blocked" : "error";
      this.broadcastAgentStatus(
        blocked ? "tool_completed" : "error",
        toolContext,
        formatToolActivityDetail(toolName, args, phase, errorMessage),
        {
          toolName,
          toolCallId,
          toolPhase: phase,
        }
      );
      if (blocked) {
        await emitAgentHook({
          type: "tool_blocked",
          context: hookContext,
          toolName,
          args,
          reason: errorMessage,
        });
        return {
          skipped: false,
          result: { error: errorMessage, blocked: true },
        };
      }
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
    messages = coalesceSystemMessages(messages);
    if (provider && typeof provider === "object" && "id" in provider) {
      const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
        provider as Parameters<typeof providerManager.refreshOAuthCredentialsIfNeeded>[0]
      );
      if (refreshed) {
        provider = refreshed as typeof provider;
      }
    }
    const providerName =
      provider && typeof provider === "object" && "provider" in provider
        ? String((provider as { provider?: unknown }).provider || "")
        : "";
    const hookContext = this.buildHookContext(providerName || undefined, model, toolContext);

    await emitAgentHook({
      type: "llm_request",
      context: hookContext,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      toolNames: tools.map((tool) => tool.name),
    });

    const startedAt = performance.now();
    const sessionTokenUsageBefore = getSessionTokenUsageSnapshot(toolContext?.sessionId);
    try {
      const result = await this.callLLMInternal(provider, model, messages, tools, toolContext);
      const durationMs = Math.round(performance.now() - startedAt);
      const sanitizedResult =
        typeof result.content === "string" && hasTextToolCallMarkup(result.content)
          ? { ...result, content: sanitizeAssistantContent(result.content) }
          : result;
      trackEstimatedSessionTokenUsage({
        before: sessionTokenUsageBefore,
        durationMs,
        messages,
        model,
        providerName,
        providerUrl:
          provider && typeof provider === "object" && "base_url" in provider
            ? String((provider as { base_url?: unknown }).base_url || "")
            : "",
        result: sanitizedResult,
        toolContext,
      });
      await emitAgentHook({
        type: "llm_response",
        context: hookContext,
        content: sanitizedResult.content,
        toolNames: (sanitizedResult.tool_calls || []).map((toolCall) => toolCall.name),
        durationMs,
      });
      return sanitizedResult;
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
    const baseUrl = providerInfo.base_url || getProviderBaseUrl(providerConfig);
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

    const modelId = model || getDefaultModel(providerConfig);
    const apiFamily = providerDefinition?.api || "openai-completions";
    const providerHeaders = providerDefinition?.headers || {};
    const customHeaders = (providerInfo as { headers?: Record<string, string> }).headers || {};
    const mergedHeaders = { ...providerHeaders, ...customHeaders };
    const modelParams = this.resolveModelParams(toolContext);
    const modelMaxOutputTokens = resolveModelMaxOutputTokens(
      providerConfig,
      providerInfo.id,
      modelId
    );
    const modelContextWindowTokens = resolveModelContextWindowTokens(
      providerConfig,
      providerInfo.id,
      modelId
    );

    if (apiFamily === "anthropic-messages" || apiFamily === "anthropic-vertex") {
      return this.callAnthropicAPI(
        baseUrl,
        resolvedAuth,
        modelId,
        messages,
        tools,
        providerConfig,
        modelMaxOutputTokens,
        toolContext,
        modelParams,
        providerInfo.id,
        apiFamily === "anthropic-vertex"
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
        toolContext,
        modelContextWindowTokens,
        providerInfo.id
      );
    }

    if (
      apiFamily === "openai-completions" ||
      apiFamily === "openai-responses" ||
      apiFamily === "ollama" ||
      apiFamily === "github-copilot"
    ) {
      const preferMaxCompletionTokens =
        apiFamily === "openai-responses" ||
        apiFamily === "github-copilot" ||
        shouldPreferMaxCompletionTokens(providerConfig);
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
          contextWindowTokens: modelContextWindowTokens,
          providerId: providerInfo.id,
        }
      );
    }

    if (apiFamily === "google-generative-ai" || apiFamily === "google-vertex") {
      return this.callGoogleGenerativeAI(
        baseUrl,
        resolvedAuth,
        providerAuthType,
        modelId,
        messages,
        tools,
        providerConfig,
        modelMaxOutputTokens,
        toolContext,
        providerInfo.id,
        apiFamily === "google-vertex"
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
      {
        maxOutputTokens: modelMaxOutputTokens,
        contextWindowTokens: modelContextWindowTokens,
      }
    );
  }

  private resolveContextGuardBudgets(contextWindowTokens: number): {
    contextBudgetChars: number;
    maxSingleToolResultChars: number;
  } {
    const safeContextTokens = Math.max(1024, Math.floor(contextWindowTokens));
    const contextBudgetChars = Math.max(
      4096,
      Math.floor(
        safeContextTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * CONTEXT_INPUT_HEADROOM_RATIO
      )
    );
    const maxSingleToolResultChars = Math.max(
      MIN_TOOL_RESULT_CHARS,
      Math.min(
        HARD_MAX_TOOL_RESULT_CHARS,
        Math.floor(
          safeContextTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * MAX_TOOL_RESULT_CONTEXT_SHARE
        )
      )
    );
    return {
      contextBudgetChars,
      maxSingleToolResultChars,
    };
  }

  private estimateAnthropicMessageChars(message: Record<string, unknown>): number {
    const content = message.content;
    if (typeof content === "string") {
      return content.length;
    }
    if (!Array.isArray(content)) {
      return 0;
    }

    let total = 0;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const typed = block as Record<string, unknown>;
      if (typeof typed.text === "string") {
        total += typed.text.length;
        continue;
      }
      if (typeof typed.content === "string") {
        total += typed.content.length;
        continue;
      }
      try {
        const serialized = JSON.stringify(block);
        total += typeof serialized === "string" ? serialized.length : 0;
      } catch {
        total += 128;
      }
    }
    return total;
  }

  private estimateAnthropicContextChars(messages: Record<string, unknown>[]): number {
    return messages.reduce(
      (sum, message) => sum + this.estimateAnthropicMessageChars(message) + 64,
      0
    );
  }

  private truncateTextToContextBudget(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    const suffix = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}`;
    if (maxChars <= suffix.length) {
      return CONTEXT_LIMIT_TRUNCATION_NOTICE;
    }
    const budget = Math.max(0, maxChars - suffix.length);
    let cutPoint = budget;
    const nearestNewline = text.lastIndexOf("\n", budget);
    if (nearestNewline > budget * 0.7) {
      cutPoint = nearestNewline;
    }
    return text.slice(0, cutPoint) + suffix;
  }

  protected truncateTextWithHeadAndTail(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const marker = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}\n[...${Math.max(1, text.length - maxChars)} chars truncated...]\n`;
    const budget = Math.max(0, maxChars - marker.length);
    if (budget <= 16) {
      return this.truncateTextToContextBudget(text, maxChars);
    }
    const headBudget = Math.floor(budget * 0.7);
    const tailBudget = budget - headBudget;
    const head = text.slice(0, headBudget);
    const tail = text.slice(text.length - tailBudget);
    return head + marker + tail;
  }

  private truncateToolResultContentForContext(
    resultPayload: unknown,
    maxChars: number,
    recovery?: { sessionId?: string; toolName?: string; toolCallId?: string }
  ): string {
    const serialized = formatToolResultForModel(resultPayload, {
      toonEnabled: config.getTokenOptimizationSettings().toonStructuredDataEnabled,
    });
    return formatRecoverableToolOutputPreview(serialized, maxChars, recovery).content;
  }

  private compactAnthropicLoopMessagesForContext(
    messages: Record<string, unknown>[],
    contextBudgetChars: number,
    aggressive = false,
    context?: { model?: string; toolContext?: ToolContext }
  ): boolean {
    const beforeChars = this.estimateAnthropicContextChars(messages);
    let totalChars = beforeChars;
    if (totalChars <= contextBudgetChars && !aggressive) return false;

    const minRecentMessagesToKeep = aggressive ? 0 : 6;
    let compacted = false;
    let forceCompaction = aggressive;

    for (let index = 0; index < messages.length; index += 1) {
      if (!forceCompaction && totalChars <= contextBudgetChars) break;
      const remaining = messages.length - index;
      if (remaining <= minRecentMessagesToKeep) break;

      const message = messages[index];
      if (!message || message.role !== "user" || !Array.isArray(message.content)) {
        continue;
      }

      let changed = false;
      const nextContent = message.content.map((block) => {
        if (!block || typeof block !== "object") return block;
        const typed = block as Record<string, unknown>;
        if (typed.type !== "tool_result" || typeof typed.content !== "string") {
          return block;
        }
        if (typed.content.includes(TOOL_RESULT_COMPACTION_NOTICE)) {
          return block;
        }
        changed = true;
        return {
          ...typed,
          content: TOOL_RESULT_COMPACTION_NOTICE,
        };
      });

      if (!changed) continue;
      message.content = nextContent;
      compacted = true;
      forceCompaction = false;
      totalChars = this.estimateAnthropicContextChars(messages);
    }

    if (compacted) {
      recordMidLoopContextCompaction({
        beforeChars,
        afterChars: totalChars,
        messageCount: messages.length,
        model: context?.model,
        toolContext: context?.toolContext,
      });
    }
    return compacted;
  }

  private compactOpenAILoopMessagesForContext(
    messages: Record<string, unknown>[],
    contextBudgetChars: number,
    aggressive = false,
    context?: { model?: string; toolContext?: ToolContext }
  ): boolean {
    const beforeChars = JSON.stringify(messages).length;
    const elided = compactOpenAIChatTranscriptInPlace(messages, contextBudgetChars, { aggressive });
    if (elided > 0) {
      recordMidLoopContextCompaction({
        beforeChars,
        afterChars: JSON.stringify(messages).length,
        messageCount: messages.length,
        model: context?.model,
        toolContext: context?.toolContext,
      });
    }
    return elided > 0;
  }

  private compactOpenAIRequestMessagesForContext(
    requestBody: Record<string, unknown>,
    contextWindowTokens: number | undefined,
    aggressive = false
  ): boolean {
    return compactOpenAIRequestMessages(requestBody, {
      contextWindowTokens,
      defaultContextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      charsPerToken: CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
      estimateRequestInputTokens: (body) => this.estimateOpenAIRequestInputTokens(body),
      aggressive,
    });
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

  private shouldRetryWithAutoToolChoice(
    status: number,
    errorText: string,
    requestBody: Record<string, unknown>
  ): boolean {
    if (status !== 400) return false;

    const toolChoice = requestBody.tool_choice;
    if (toolChoice === undefined) return false;

    const normalized = errorText.toLowerCase();
    const mentionsToolChoice = normalized.includes("tool_choice");
    const mentionsThinkingIncompatibility =
      normalized.includes("thinking enabled") ||
      normalized.includes("thinking is enabled") ||
      normalized.includes("reasoning enabled") ||
      (normalized.includes("incompatible") && normalized.includes("thinking"));
    const alreadyAuto =
      toolChoice === "auto" ||
      (typeof toolChoice === "object" &&
        toolChoice !== null &&
        "type" in toolChoice &&
        (toolChoice as { type?: unknown }).type === "auto");

    return mentionsToolChoice && mentionsThinkingIncompatibility && !alreadyAuto;
  }

  private toAutoToolChoiceRequestBody(
    requestBody: Record<string, unknown>
  ): Record<string, unknown> {
    const nextBody: Record<string, unknown> = { ...requestBody };
    if (nextBody.tools !== undefined) {
      nextBody.tool_choice = "auto";
    } else {
      delete nextBody.tool_choice;
    }
    return nextBody;
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

  private getOpenAITokenLimitFromRequestBody(
    requestBody: Record<string, unknown>
  ): number | undefined {
    const completionLimit = requestBody.max_completion_tokens;
    if (
      typeof completionLimit === "number" &&
      Number.isFinite(completionLimit) &&
      completionLimit > 0
    ) {
      return Math.max(1, Math.floor(completionLimit));
    }
    const maxTokensLimit = requestBody.max_tokens;
    if (
      typeof maxTokensLimit === "number" &&
      Number.isFinite(maxTokensLimit) &&
      maxTokensLimit > 0
    ) {
      return Math.max(1, Math.floor(maxTokensLimit));
    }
    return undefined;
  }

  private setOpenAITokenLimitOnRequestBody(
    requestBody: Record<string, unknown>,
    tokenLimit: number
  ): void {
    const normalizedLimit =
      Number.isFinite(tokenLimit) && tokenLimit > 0 ? Math.max(1, Math.floor(tokenLimit)) : 1;
    if (typeof requestBody.max_completion_tokens === "number") {
      delete requestBody.max_tokens;
      requestBody.max_completion_tokens = normalizedLimit;
      return;
    }
    if (typeof requestBody.max_tokens === "number") {
      delete requestBody.max_completion_tokens;
      requestBody.max_tokens = normalizedLimit;
      return;
    }
    requestBody.max_tokens = normalizedLimit;
  }

  private estimateOpenAIRequestInputTokens(requestBody: Record<string, unknown>): number {
    const payload: Record<string, unknown> = {};
    if (requestBody.model !== undefined) payload.model = requestBody.model;
    if (requestBody.messages !== undefined) payload.messages = requestBody.messages;
    if (requestBody.tools !== undefined) payload.tools = requestBody.tools;
    if (requestBody.tool_choice !== undefined) payload.tool_choice = requestBody.tool_choice;

    try {
      const serialized = JSON.stringify(payload);
      if (!serialized) return 0;
      return Math.max(1, Math.ceil(serialized.length / CONTEXT_CHARS_PER_TOKEN_ESTIMATE));
    } catch {
      return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    }
  }

  private resolveOpenAIRequestTokenLimit(
    requestBody: Record<string, unknown>,
    maxOutputTokens: number,
    contextWindowTokens?: number
  ): number {
    const requestedOutputTokens =
      Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
        ? Math.max(1, Math.floor(maxOutputTokens))
        : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
    const normalizedContextWindow =
      typeof contextWindowTokens === "number" &&
      Number.isFinite(contextWindowTokens) &&
      contextWindowTokens > 0
        ? Math.max(1, Math.floor(contextWindowTokens))
        : Math.max(requestedOutputTokens, DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);

    const estimatedInputTokens = this.estimateOpenAIRequestInputTokens(requestBody);
    const reserveTokens = Math.max(128, Math.floor(normalizedContextWindow * 0.01));
    const availableOutputTokens = Math.max(
      1,
      normalizedContextWindow - estimatedInputTokens - reserveTokens
    );
    return Math.max(1, Math.min(requestedOutputTokens, availableOutputTokens));
  }

  private reduceOpenAITokenLimitForContextRetry(
    requestBody: Record<string, unknown>,
    errorText: string
  ): Record<string, unknown> | undefined {
    const currentLimit = this.getOpenAITokenLimitFromRequestBody(requestBody);
    if (!currentLimit) return undefined;

    const normalizedError = errorText.toLowerCase();
    if (
      normalizedError.includes("maximum prompt length") &&
      normalizedError.includes("request contains")
    ) {
      return undefined;
    }
    let nextLimit = Math.max(1, Math.floor(currentLimit * 0.8));

    const explicitLimitMatch = normalizedError.match(/limit:\s*(\d+)\s*\(requested:\s*(\d+)\)/i);
    if (explicitLimitMatch) {
      const limitValue = Number.parseInt(explicitLimitMatch[1] || "", 10);
      const requestedValue = Number.parseInt(explicitLimitMatch[2] || "", 10);
      if (
        Number.isFinite(limitValue) &&
        Number.isFinite(requestedValue) &&
        requestedValue > limitValue
      ) {
        const overflow = requestedValue - limitValue;
        nextLimit = Math.max(1, currentLimit - overflow - 64);
      }
    }

    if (nextLimit >= currentLimit) {
      return undefined;
    }

    const retryBody: Record<string, unknown> = { ...requestBody };
    this.setOpenAITokenLimitOnRequestBody(retryBody, nextLimit);
    return retryBody;
  }

  private async postOpenAIChatCompletions(
    baseUrl: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    errorPrefix: string,
    signal?: AbortSignal,
    rateLimitContext?: ProviderRateLimitContext,
    streamContext?: { sessionId?: string | null; agentId?: string | null }
  ): Promise<OpenAIResponse> {
    const streamSessionId = streamContext?.sessionId?.trim() || "";
    const onTextDelta =
      streamSessionId.length > 0
        ? (delta: string) => {
            try {
              broadcastTokenDelta({
                sessionId: streamSessionId,
                agentId: streamContext?.agentId || undefined,
                delta,
              });
            } catch {
              void 0;
            }
          }
        : undefined;
    let streamingDisabled = false;
    const post = async (body: Record<string, unknown>): Promise<Response | OpenAIResponse> => {
      if (streamingDisabled) {
        try {
          return await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: withLlmRequestTimeout(signal),
          });
        } catch (error) {
          throw normalizeLlmTimeoutError(error, signal);
        }
      }

      const watchdog = createStreamWatchdog({
        ...resolveLlmWatchdogDefaults(baseUrl),
        callerSignal: signal,
        label: "chat.completions",
      });
      try {
        const requestStartedAt = performance.now();
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...body,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: watchdog.signal,
        });
        if (!response.ok) {
          watchdog.dispose();
          return response;
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        if (!contentType.includes("text/event-stream")) {
          const json = (await response.json()) as OpenAIResponse;
          json.first_token_ms = Math.max(0, Math.round(performance.now() - requestStartedAt));
          watchdog.dispose();
          return json;
        }
        if (!response.body) {
          watchdog.dispose();
          throw new Error(`${errorPrefix}: empty streaming response body`);
        }
        watchdog.touch();
        const assembled = await consumeOpenAIChatStream(
          response.body,
          watchdog,
          onTextDelta,
          requestStartedAt
        );
        watchdog.dispose();
        return assembled as unknown as OpenAIResponse;
      } catch (error) {
        watchdog.dispose();
        throw watchdog.wrapError(error);
      }
    };

    let currentBody: Record<string, unknown> = { ...requestBody };
    let attemptedMaxCompletionRetry = false;
    let attemptedToolChoiceCompatibilityRetry = false;
    let contextRetryCount = 0;

    let attemptedNonStreamingRetry = false;
    while (true) {
      const result = await post(currentBody);
      if (!(result instanceof Response)) {
        return result;
      }
      const response = result;
      if (response.ok) {
        return (await response.json()) as OpenAIResponse;
      }

      const errorText = await response.text();
      this.recordHttpRateLimit(response.status, response.headers, rateLimitContext);
      if (
        !attemptedNonStreamingRetry &&
        !streamingDisabled &&
        /\bstream(_options)?\b/i.test(errorText)
      ) {
        attemptedNonStreamingRetry = true;
        streamingDisabled = true;
        console.log("[Agent] Provider rejected streaming; retrying without stream");
        continue;
      }
      if (
        !attemptedMaxCompletionRetry &&
        this.shouldRetryWithMaxCompletionTokens(response.status, errorText)
      ) {
        attemptedMaxCompletionRetry = true;
        console.log("[Agent] Retrying OpenAI request with max_completion_tokens");
        currentBody = this.toMaxCompletionTokensRequestBody(currentBody);
        continue;
      }

      if (
        !attemptedToolChoiceCompatibilityRetry &&
        this.shouldRetryWithAutoToolChoice(response.status, errorText, currentBody)
      ) {
        attemptedToolChoiceCompatibilityRetry = true;
        console.log(
          "[Agent] Retrying OpenAI request with tool_choice=auto due to thinking/tool_choice incompatibility"
        );
        currentBody = this.toAutoToolChoiceRequestBody(currentBody);
        continue;
      }

      if (contextRetryCount < 2 && response.status === 400 && isContextOverflowError(errorText)) {
        const retryBody = this.reduceOpenAITokenLimitForContextRetry(currentBody, errorText);
        if (retryBody) {
          contextRetryCount += 1;
          const previousLimit = this.getOpenAITokenLimitFromRequestBody(currentBody);
          const nextLimit = this.getOpenAITokenLimitFromRequestBody(retryBody);
          if (previousLimit && nextLimit) {
            console.log(
              `[Agent] Retrying OpenAI request with reduced token limit (${previousLimit} -> ${nextLimit})`
            );
          }
          currentBody = retryBody;
          continue;
        }
      }

      throw new Error(`${errorPrefix}: ${response.status} - ${errorText}`);
    }
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
    options?: {
      preferMaxCompletionTokens?: boolean;
      maxOutputTokens?: number;
      contextWindowTokens?: number;
      providerId?: string;
    }
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
    const contextWindowTokens =
      typeof options?.contextWindowTokens === "number" &&
      Number.isFinite(options.contextWindowTokens) &&
      options.contextWindowTokens > 0
        ? Math.max(1, Math.floor(options.contextWindowTokens))
        : undefined;
    const contextGuard = this.resolveContextGuardBudgets(
      contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    );
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => {
        if (m.role === "user" && hasImages(m.images)) {
          return {
            role: m.role,
            content: [
              ...(m.content ? [{ type: "text", text: m.content }] : []),
              ...m.images.map(toOpenAIImageBlock),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }),
    };

    const openaiEffort = normalizeReasoningEffort(
      this.resolveModelParams(toolContext).reasoning_effort
    );
    if (openaiEffort) {
      Object.assign(
        requestBody,
        openAICompatReasoningParams(
          providerConfig || "",
          coerceReasoningEffort(openaiEffort, providerConfig, modelId),
          modelId
        )
      );
    }

    if (shouldUseMiniMaxReasoningSplit(providerConfig, modelId)) {
      requestBody.reasoning_split = true;
    }

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
        const requiredToolName = toolContext.requiredToolName?.trim();
        const hasRequiredTool =
          typeof requiredToolName === "string" &&
          requiredToolName.length > 0 &&
          tools.some((tool) => tool.name === requiredToolName);
        requestBody.tool_choice = hasRequiredTool
          ? {
              type: "function",
              function: { name: requiredToolName },
            }
          : "required";
      } else {
        requestBody.tool_choice = "auto";
      }
    }

    this.compactOpenAIRequestMessagesForContext(requestBody, contextWindowTokens);
    const initialTokenLimit = this.resolveOpenAIRequestTokenLimit(
      requestBody,
      maxOutputTokens,
      contextWindowTokens
    );
    this.applyOpenAITokenLimit(requestBody, preferMaxCompletionTokens, initialTokenLimit);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders, // Merge custom headers (e.g., User-Agent for Kimi Code)
    };
    if (auth) {
      const apiKeyHeader = (
        providerCatalog[providerConfig as ProviderType] as { apiKeyHeader?: string } | undefined
      )?.apiKeyHeader;
      applyProviderApiKey(headers, auth, apiKeyHeader);
    }

    console.log(`[Agent] Sending request with headers:`, JSON.stringify(Object.keys(headers)));

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const startTime = performance.now();

    let data: OpenAIResponse;
    try {
      data = await this.postOpenAIChatCompletions(
        baseUrl,
        headers,
        requestBody,
        "API error",
        toolContext?.abortSignal,
        { providerId: options?.providerId, providerType: providerConfig },
        { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
      );
    } catch (error) {
      if (!isContextOverflowError(this.normalizeErrorMessage(error))) {
        throw error;
      }
      const compacted = this.compactOpenAIRequestMessagesForContext(
        requestBody,
        contextWindowTokens,
        true
      );
      if (!compacted) {
        throw error;
      }
      const retryLimit = this.resolveOpenAIRequestTokenLimit(
        requestBody,
        maxOutputTokens,
        contextWindowTokens
      );
      this.applyOpenAITokenLimit(requestBody, preferMaxCompletionTokens, retryLimit);
      data = await this.postOpenAIChatCompletions(
        baseUrl,
        headers,
        requestBody,
        "API error",
        toolContext?.abortSignal,
        { providerId: options?.providerId, providerType: providerConfig },
        { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
      );
    }

    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    trackOpenAIResponseUsage(data, {
      model: modelId,
      provider: providerConfig || "openai-compat",
      providerUrl: baseUrl,
      durationMs,
      sessionId: sessionIdForVisibleTokenUsage(toolContext),
    });

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
    let finalContent = "";
    let lastProgressThought = "";
    let webResearchToolCalls = 0;
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

      const normalizedToolCalls = normalizeOpenAIToolCalls(message, iterations, allowedToolNames);
      if (normalizedToolCalls.length === 0) {
        finalContent = typeof message.content === "string" ? message.content : "";
        break;
      }

      const progressThought = summarizeProgressThought(message.content);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      console.log(
        `[Agent] Agentic loop iteration ${iterations}: ${normalizedToolCalls.length} tool calls`
      );

      const toolResults: Array<{
        tool_call_id: string;
        role: "tool";
        content: string;
      }> = [];
      const iterationToolCalls: AgentToolCallResult[] = [];

      for (const toolCall of normalizedToolCalls) {
        const toolName = toolCall.name;
        const toolCallId = toolCall.id;
        const args = toolCall.args;

        if (!toolName) {
          const missingNamePayload = { error: "Tool call missing tool name" };
          iterationToolCalls.push({
            name: "__missing_tool_name__",
            args,
            result: missingNamePayload,
          });
          toolResults.push({
            tool_call_id: toolCallId,
            role: "tool",
            content: this.truncateToolResultContentForContext(
              missingNamePayload,
              contextGuard.maxSingleToolResultChars,
              {
                sessionId: toolContext?.sessionId,
                toolName: "__missing_tool_name__",
                toolCallId,
              }
            ),
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
          executed.result === undefined
            ? { error: `Tool execution skipped for ${toolName}` }
            : executed.result;
        if (!executed.skipped) {
          iterationToolCalls.push({
            name: toolName,
            args,
            result: resultPayload,
          });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars,
            {
              sessionId: toolContext?.sessionId,
              toolName,
              toolCallId,
            }
          ),
        });
      }

      if (toolResults.length === 0) {
        console.warn("[Agent] Tool loop produced no tool results; stopping loop early");
        break;
      }
      if (iterationToolCalls.length === 0) {
        console.warn("[Agent] Tool loop produced no executable tool calls; stopping loop early");
        if (!finalContent.trim()) {
          finalContent = this.missingExecutableToolCallsMessage();
        }
        break;
      }

      webResearchToolCalls += countWebResearchCalls(
        iterationToolCalls.map((toolCall) => toolCall.name)
      );
      const forceResearchSynthesis = webResearchBudgetReached(webResearchToolCalls);

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

      currentMessages.push(
        toOpenAIReplayMessageWithNormalizedToolCalls(message, normalizedToolCalls)
      );
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }
      if (forceResearchSynthesis) {
        currentMessages.push({
          role: "user",
          content: WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
        });
      }
      const steeringText = this.consumeSteeringText(toolContext);
      if (steeringText) {
        currentMessages.push({ role: "user", content: steeringText });
      }
      this.compactOpenAILoopMessagesForContext(
        currentMessages,
        contextGuard.contextBudgetChars,
        false,
        { model: modelId, toolContext }
      );

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
      };
      if (shouldUseMiniMaxReasoningSplit(providerConfig, modelId)) {
        loopRequestBody.reasoning_split = true;
      }

      if (!forceResearchSynthesis && tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.input_schema || { type: "object", properties: {} },
          },
        }));
        loopRequestBody.tool_choice = "auto";
      }

      this.compactOpenAIRequestMessagesForContext(loopRequestBody, contextWindowTokens);
      const loopTokenLimit = this.resolveOpenAIRequestTokenLimit(
        loopRequestBody,
        maxOutputTokens,
        contextWindowTokens
      );
      this.applyOpenAITokenLimit(loopRequestBody, preferMaxCompletionTokens, loopTokenLimit);

      let loopData: OpenAIResponse;
      const loopRequestStartedAt = performance.now();
      try {
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          loopRequestBody,
          "API error in agentic loop",
          toolContext?.abortSignal,
          { providerId: options?.providerId, providerType: providerConfig },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
      } catch (error) {
        const errorMessage = this.normalizeErrorMessage(error);
        if (!isContextOverflowError(errorMessage)) {
          throw error;
        }
        const compacted = this.compactOpenAILoopMessagesForContext(
          currentMessages,
          Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
          true,
          { model: modelId, toolContext }
        );
        if (!compacted) {
          throw error;
        }
        const retryLoopRequestBody: Record<string, unknown> = {
          ...loopRequestBody,
          messages: currentMessages,
        };
        const retryLoopTokenLimit = this.resolveOpenAIRequestTokenLimit(
          retryLoopRequestBody,
          maxOutputTokens,
          contextWindowTokens
        );
        this.applyOpenAITokenLimit(
          retryLoopRequestBody,
          preferMaxCompletionTokens,
          retryLoopTokenLimit
        );
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          retryLoopRequestBody,
          "API error in agentic loop",
          toolContext?.abortSignal,
          { providerId: options?.providerId, providerType: providerConfig },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
      }
      trackOpenAIResponseUsage(loopData, {
        model: modelId,
        provider: providerConfig || "openai-compat",
        providerUrl: baseUrl,
        durationMs: Math.round(performance.now() - loopRequestStartedAt),
        sessionId: sessionIdForVisibleTokenUsage(toolContext),
      });
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        console.warn("[Agent] Agentic loop got an empty completion; stopping loop");
        break;
      }
    }

    if (!limitReason && !finalContent.trim() && allToolCalls.length > 0) {
      console.warn("[Agent] Final content empty after tool loop; requesting a closing response");
      try {
        currentMessages.push({
          role: "user",
          content:
            "Reply to the user now with your findings from the tool results above. Do not call any more tools.",
        });
        const nudgeBody: Record<string, unknown> = {
          model: modelId,
          messages: currentMessages,
        };
        this.compactOpenAIRequestMessagesForContext(nudgeBody, contextWindowTokens);
        const limit = this.resolveOpenAIRequestTokenLimit(
          nudgeBody,
          maxOutputTokens,
          contextWindowTokens
        );
        this.applyOpenAITokenLimit(nudgeBody, preferMaxCompletionTokens, limit);
        const nudgeStartedAt = performance.now();
        const nudgeData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          nudgeBody,
          "API error in agentic loop closing response",
          toolContext?.abortSignal,
          { providerId: options?.providerId, providerType: providerConfig },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
        trackOpenAIResponseUsage(nudgeData, {
          model: modelId,
          provider: providerConfig || "openai-compat",
          providerUrl: baseUrl,
          durationMs: Math.round(performance.now() - nudgeStartedAt),
          sessionId: sessionIdForVisibleTokenUsage(toolContext),
        });
        const nudgeContent = nudgeData.choices?.[0]?.message?.content;
        if (typeof nudgeContent === "string" && nudgeContent.trim()) finalContent = nudgeContent;
      } catch (error) {
        console.warn(`[Agent] Closing-response nudge failed: ${this.normalizeErrorMessage(error)}`);
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
      content: sanitizeAssistantContent(finalContent),
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
          content: openAIResponsesUserContent(message.content, message.images),
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

  private async parseOpenAICodexTurnResponse(
    response: Response,
    sessionId?: string,
    agentId?: string,
    watchdog?: StreamWatchdog,
    requestStartedAt?: number
  ): Promise<OpenAICodexTurnResult> {
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
                cachedInputTokens: Number(
                  (json.usage as OpenAIUsage).prompt_tokens_details?.cached_tokens || 0
                ),
              }
            : undefined,
          firstTokenMs:
            requestStartedAt !== undefined
              ? Math.max(0, Math.round(performance.now() - requestStartedAt))
              : undefined,
        };
      }
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    let outputText = "";
    let usage: OpenAICodexUsage | undefined;
    let firstTokenMs: number | undefined;
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
      watchdog?.touch();
      const type = typeof event.type === "string" ? event.type : "";
      if (
        firstTokenMs === undefined &&
        requestStartedAt !== undefined &&
        (type === "response.output_text.delta" || type === "response.output_item.added")
      ) {
        firstTokenMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
      }

      if (type === "response.output_text.delta") {
        if (typeof event.delta === "string") {
          outputText += event.delta;
          if (sessionId) {
            try {
              broadcastTokenDelta({
                sessionId,
                agentId,
                delta: event.delta,
              });
            } catch {
              void 0;
            }
          }
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
          const inputDetails = usageObj.input_tokens_details as Record<string, unknown> | undefined;
          const cachedInputTokens =
            typeof inputDetails?.cached_tokens === "number" &&
            Number.isFinite(inputDetails.cached_tokens)
              ? Math.floor(inputDetails.cached_tokens)
              : 0;
          usage = { inputTokens, outputTokens, cachedInputTokens };
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
      firstTokenMs,
    };
  }

  private async postOpenAICodexTurn(
    url: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    requestedModel: string,
    sessionId?: string,
    agentId?: string,
    signal?: AbortSignal,
    rateLimitContext?: ProviderRateLimitContext
  ): Promise<OpenAICodexTurnResult & { resolvedModel: string }> {
    const candidates = getOpenAICodexModelCandidates(requestedModel);
    let finalError = "OpenAI Codex request failed";

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const body = { ...requestBody, model: candidate };
      const watchdog = createStreamWatchdog({
        ...resolveLlmWatchdogDefaults(url),
        callerSignal: signal,
        label: "Codex",
      });
      let response: Response;
      const requestStartedAt = performance.now();
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: watchdog.signal,
        });
      } catch (error) {
        watchdog.dispose();
        throw watchdog.wrapError(error);
      }

      if (!response.ok) {
        watchdog.dispose();
        const errorText = await response.text();
        this.recordHttpRateLimit(response.status, response.headers, rateLimitContext);
        finalError = `API error: ${response.status} - ${errorText}`;
        if (
          index < candidates.length - 1 &&
          shouldRetryOpenAICodexModel(response.status, errorText)
        ) {
          console.warn(
            `[Agent] OpenAI Codex model ${candidate} unavailable, retrying with ${candidates[index + 1]}`
          );
          continue;
        }
        throw new Error(finalError);
      }

      try {
        watchdog.touch();
        const parsed = await this.parseOpenAICodexTurnResponse(
          response,
          sessionId,
          agentId,
          watchdog,
          requestStartedAt
        );
        watchdog.dispose();
        return { ...parsed, resolvedModel: candidate };
      } catch (error) {
        watchdog.dispose();
        throw watchdog.wrapError(error);
      }
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
    toolContext?: ToolContext,
    contextWindowTokens?: number,
    providerId?: string
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const codexUrl = this.resolveOpenAICodexResponsesUrl(baseUrl);
    const codexContextWindow =
      typeof contextWindowTokens === "number" && contextWindowTokens > 0
        ? contextWindowTokens
        : DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    const { contextBudgetChars: codexBudgetChars, maxSingleToolResultChars: codexMaxOutputChars } =
      this.resolveContextGuardBudgets(codexContextWindow);
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
    const accountId = extractOpenAICodexAccountId(auth);
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
    let closingResponseRequested = false;
    let skillLearningNudged = false;
    let preservedFinalContent: string | null = null;
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

      const sanitized = sanitizeCodexInputItems(inputItems);
      if (sanitized.droppedOutputs > 0) {
        console.warn(
          `[Agent] Codex input repair: dropped ${sanitized.droppedOutputs} orphaned tool output(s) before request`
        );
      }

      const requestBody: Record<string, unknown> = {
        model: activeModelId,
        store: false,
        stream: true,
        input: inputItems,
        text: { verbosity: "medium" },
        include: ["reasoning.encrypted_content"],
        tool_choice: closingResponseRequested
          ? "none"
          : toolContext?.requireToolUse === true && iterations === 1
            ? "required"
            : "auto",
        parallel_tool_calls: true,
      };
      const codexEffort = normalizeReasoningEffort(
        this.resolveModelParams(toolContext).reasoning_effort
      );
      if (codexEffort) {
        requestBody.reasoning = {
          effort: coerceReasoningEffort(codexEffort, providerConfig, activeModelId),
          summary: "auto",
        };
      }
      if (instructions && instructions.trim().length > 0) {
        requestBody.instructions = instructions;
      }
      if (toolDefinitions.length > 0 && !closingResponseRequested) {
        requestBody.tools = toolDefinitions;
      }
      if (toolContext?.sessionId) {
        requestBody.prompt_cache_key = toolContext.sessionId;
      }

      const startTime = performance.now();
      const runCodexTurn = () =>
        this.postOpenAICodexTurn(
          codexUrl,
          headers,
          requestBody,
          activeModelId,
          toolContext?.suppressStreaming ? undefined : toolContext?.sessionId,
          toolContext?.agentId,
          toolContext?.abortSignal,
          { providerId, providerType: providerConfig }
        );
      let turn: OpenAICodexTurnResult & { resolvedModel: string };
      try {
        turn = await runCodexTurn();
      } catch (error) {
        if (!isContextOverflowError(this.normalizeErrorMessage(error))) throw error;
        compactCodexInputItemsForContext(inputItems, Math.max(4096, codexBudgetChars * 0.65), true);
        turn = await runCodexTurn();
      }
      activeModelId = turn.resolvedModel;
      const durationMs = Math.round(performance.now() - startTime);

      if (turn.usage) {
        trackTokenUsage(
          activeModelId,
          providerConfig || "openai-codex",
          codexUrl,
          turn.usage.inputTokens,
          turn.usage.outputTokens,
          durationMs,
          {
            sessionId: sessionIdForVisibleTokenUsage(toolContext),
            cachedInputTokens: turn.usage.cachedInputTokens,
            cacheWriteTokens: turn.usage.cacheWriteTokens,
            firstTokenMs: turn.firstTokenMs ?? durationMs,
          }
        );
      }

      if (turn.toolCalls.length === 0) {
        if (turn.content.trim().length > 0) {
          if (
            !skillLearningNudged &&
            preservedFinalContent === null &&
            shouldNudgeSkillLearning(allToolCalls)
          ) {
            skillLearningNudged = true;
            preservedFinalContent = turn.content.trim();
            inputItems.push({
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "SYSTEM: You just completed a complex multi-step task. If (and only if) the procedure is genuinely reusable and no existing skill covers it, call skill_save now to codify it as a concise SKILL.md (when-to-use, prerequisites, verified steps). Otherwise reply with exactly 'no skill needed'. Do not repeat your answer to the user — they already have it.",
                },
              ],
            });
            continue;
          }
          finalContent = preservedFinalContent ?? turn.content.trim();
          break;
        }
        if (skillLearningNudged && preservedFinalContent !== null) {
          finalContent = preservedFinalContent;
          break;
        }
        if (allToolCalls.length > 0 && !closingResponseRequested) {
          inputItems.push({
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Reply to the user now with your findings from the tool results above. Do not call any more tools.",
              },
            ],
          });
          closingResponseRequested = true;
          continue;
        }
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
        const resultPayload =
          executed.result === undefined ? { skipped: true, reason: "no result" } : executed.result;
        if (!executed.skipped) {
          const toolCallRecord = {
            name: toolCall.name,
            args: toolCall.args,
            result: resultPayload,
          };
          allToolCalls.push(toolCallRecord);
          iterationToolCalls.push(toolCallRecord);
        }
        functionCallOutputs.push({
          type: "function_call_output",
          call_id: toolCall.callId,
          output: this.truncateToolResultContentForContext(resultPayload, codexMaxOutputChars, {
            sessionId: toolContext?.sessionId,
            toolName: toolCall.name,
            toolCallId: toolCall.callId,
          }),
        });
      }

      if (iterationToolCalls.length === 0) {
        if (!finalContent.trim()) {
          finalContent = this.missingExecutableToolCallsMessage();
        }
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
      const steeringText = this.consumeSteeringText(toolContext);
      if (steeringText) {
        inputItems.push({
          role: "user",
          content: [{ type: "input_text", text: steeringText }],
        });
      }
      compactCodexInputItemsForContext(inputItems, codexBudgetChars);
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
    toolContext?: ToolContext,
    providerId?: string,
    vertex: boolean = false
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const systemMessage = messages.find((message) => message.role === "system");
    const chatMessages = messages.filter((message) => message.role !== "system");
    const contents: GoogleContent[] = chatMessages.map((message) => {
      const role = message.role === "assistant" ? "model" : "user";
      if (role === "user" && hasImages(message.images)) {
        const parts: unknown[] = [];
        if (message.content) parts.push({ text: message.content });
        for (const img of message.images) {
          const part = toGoogleImagePart(img);
          if (part) parts.push(part);
        }
        return { role, parts: parts as GooglePart[] };
      }
      return { role, parts: [{ text: message.content }] };
    });

    const headers = vertex
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.trim()}`,
        }
      : parseGoogleAuthHeaders(auth, providerAuthType).headers;
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

      const googleGenConfig: Record<string, unknown> = { maxOutputTokens };
      const googleEffort = normalizeReasoningEffort(
        this.resolveModelParams(toolContext).reasoning_effort
      );
      if (googleEffort) {
        googleGenConfig.thinkingConfig = googleThinkingConfig(googleEffort, normalizedModelId);
      }
      const requestBody: Record<string, unknown> = {
        contents,
        generationConfig: googleGenConfig,
      };

      if (systemMessage) {
        requestBody.systemInstruction = {
          parts: [{ text: systemMessage.content }],
        };
      }

      if (tools.length > 0) {
        requestBody.tools = [
          {
            functionDeclarations: tools.map(googleFunctionDeclaration),
          },
        ];
      }

      const startTime = performance.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: withLlmRequestTimeout(toolContext?.abortSignal),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.recordHttpRateLimit(response.status, response.headers, {
          providerId,
          providerType: providerConfig,
        });
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as GoogleResponse;
      const durationMs = Math.round(performance.now() - startTime);
      const usage = data.usageMetadata;
      if (usage) {
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs, {
          sessionId: sessionIdForVisibleTokenUsage(toolContext),
          cachedInputTokens: usage.cachedContentTokenCount || 0,
          firstTokenMs: durationMs,
        });
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

        const toolCallRecord = {
          name: toolCall.name,
          args,
          result: executed.result,
        };
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
      const steeringText = this.consumeSteeringText(toolContext);
      contents.push({
        role: "user",
        parts: steeringText ? [...toolResponses, { text: steeringText }] : toolResponses,
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
      .map(
        (message) =>
          ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: bedrockUserContent(
              message.content,
              message.role === "user" ? message.images : undefined
            ),
          }) as unknown as BedrockMessage
      );
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
              json: (tool.input_schema || {
                type: "object",
                properties: {},
              }) as SmithyDocumentType,
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
          durationMs,
          {
            sessionId: sessionIdForVisibleTokenUsage(toolContext),
            firstTokenMs: durationMs,
          }
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

        const toolCallRecord = {
          name: toolUse.name,
          args,
          result: executed.result,
        };
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
      const steeringText = this.consumeSteeringText(toolContext);
      conversation.push({
        role: "user",
        content: steeringText ? [...toolResults, { text: steeringText }] : toolResults,
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
    modelParams?: Record<string, unknown>,
    providerId?: string,
    vertex: boolean = false
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "assistant" ? "assistant" : "user";
        if (role === "user" && hasImages(m.images)) {
          return {
            role,
            content: [
              ...(m.content ? [{ type: "text", text: m.content }] : []),
              ...m.images.map(toAnthropicImageBlock),
            ],
          };
        }
        return { role, content: m.content };
      });

    const anthropicEndpoint = anthropicEndpointPath(modelId, vertex);

    const requestBody: Record<string, unknown> = anthropicRequestBase(
      modelId,
      chatMessages,
      maxOutputTokens,
      vertex
    );

    if (systemMessage) {
      requestBody.system = systemMessage.content;
    }

    const anthropicEffort = normalizeReasoningEffort(modelParams?.reasoning_effort);
    if (anthropicEffort) {
      const resolvedEffort = coerceReasoningEffort(anthropicEffort, providerConfig, modelId);
      if (usesAnthropicAdaptiveThinking(modelId)) {
        requestBody.thinking = { type: "adaptive", display: "summarized" };
        requestBody.output_config = { effort: resolvedEffort };
      } else {
        requestBody.thinking = {
          type: "enabled",
          budget_tokens: anthropicThinkingBudget(resolvedEffort, maxOutputTokens),
        };
      }
      delete requestBody.temperature;
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.input_schema || { type: "object", properties: {} },
      }));
      requestBody.tool_choice = { type: "auto" };
    }

    const headers: Record<string, string> = anthropicRequestHeaders(auth, vertex);

    if (!vertex && modelParams?.context1m === true) {
      headers["anthropic-beta"] = this.mergeHeaderToken(
        headers["anthropic-beta"],
        ANTHROPIC_CONTEXT_1M_BETA
      );
    }

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const cached = applyAnthropicCacheControl(
      {
        system: requestBody.system as string | undefined,
        messages: requestBody.messages as AnthropicCacheRequest["messages"],
      },
      { strategy: "system_and_3", ttl: "1h" }
    );
    if (cached.system !== undefined) requestBody.system = cached.system;
    requestBody.messages = cached.messages;

    const startTime = performance.now();
    const INITIAL_TRANSIENT_CODES = new Set([429, 500, 502, 503, 520, 529]);
    const INITIAL_MAX_RETRIES = 3;
    let response: Response | null = null;
    let lastInitialError = "";
    const poolName = "anthropic";
    let activeCredential: PooledCredential | null =
      !vertex && poolSize(poolName) > 0 ? acquireCredential(poolName) : null;
    let currentApiKey = activeCredential?.value ?? auth;

    for (let attempt = 0; attempt <= INITIAL_MAX_RETRIES; attempt++) {
      if (vertex) {
        headers.Authorization = `Bearer ${currentApiKey}`;
      } else {
        headers["x-api-key"] = currentApiKey;
      }
      response = await fetch(`${baseUrl}${anthropicEndpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: withLlmRequestTimeout(toolContext?.abortSignal),
      });

      if (response.ok) {
        if (activeCredential) markCredentialHealthy(poolName, activeCredential);
        break;
      }

      lastInitialError = await response.text();

      if (activeCredential) recordRateLimit(activeCredential.label, response.headers);
      this.recordHttpRateLimit(response.status, response.headers, {
        providerId,
        providerType: providerConfig,
      });

      if (INITIAL_TRANSIENT_CODES.has(response.status) && attempt < INITIAL_MAX_RETRIES) {
        if (response.status === 429 && activeCredential) {
          markCredentialCooldown(poolName, activeCredential, "rate_limit");
        }
        const rotated = !vertex && poolSize(poolName) > 0 ? acquireCredential(poolName) : null;
        if (rotated) {
          activeCredential = rotated;
          currentApiKey = rotated.value;
        }
        const backoffMs =
          response.status === 429
            ? Math.max(msUntilAnyAvailable(poolName), Math.min(1000 * Math.pow(2, attempt), 8000))
            : Math.min(1000 * Math.pow(2, attempt), 8000);
        console.warn(
          `[Agent] Anthropic transient error ${response.status} on initial call, ` +
            `retrying in ${backoffMs}ms (attempt ${attempt + 1}/${INITIAL_MAX_RETRIES})...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      throw new Error(`API error: ${response.status} - ${lastInitialError}`);
    }

    if (!response || !response.ok) {
      throw new Error(`API error after ${INITIAL_MAX_RETRIES} retries: ${lastInitialError}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const durationMs = Math.round(performance.now() - startTime);

    if (data.usage) {
      const inputTokens = data.usage.input_tokens || 0;
      const outputTokens = data.usage.output_tokens || 0;
      trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs, {
        sessionId: sessionIdForVisibleTokenUsage(toolContext),
        cachedInputTokens: data.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: data.usage.cache_creation_input_tokens || 0,
        firstTokenMs: durationMs,
      });
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const contextWindowTokens = resolveModelContextWindowTokens(
      providerConfig,
      providerId,
      modelId
    );
    const contextGuard = this.resolveContextGuardBudgets(contextWindowTokens);
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
    let webResearchToolCalls = 0;
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

      const toolUseBlocks = normalizeAnthropicToolUses(
        currentData.content,
        iterations,
        allowedToolNames
      );

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

      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];
      const expectedToolUseIds = new Set<string>();
      const iterationToolCalls: AgentToolCallResult[] = [];

      const preStarted = new Map<string, ReturnType<typeof this.executeToolWithHooks>>();
      if (canRunToolsInParallel(toolUseBlocks.map((b) => b.name))) {
        for (const toolUse of toolUseBlocks) {
          const id = toolUse.id;
          const name = toolUse.name;
          if (id && name) {
            preStarted.set(
              id,
              this.executeToolWithHooks(
                name,
                toolUse.args || {},
                allowedToolNames,
                toolContext,
                hookContext
              )
            );
          }
        }
      }

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name;
        const toolUseId = toolUse.id;
        if (!toolUseId) {
          console.warn("[Agent] Anthropic tool_use missing id; skipping unmatched tool block");
          continue;
        }
        expectedToolUseIds.add(toolUseId);
        const args = toolUse.args || {};

        if (!toolName) {
          const missingNamePayload = {
            error: "Tool use block missing tool name",
          };
          iterationToolCalls.push({
            name: "__missing_tool_name__",
            args,
            result: missingNamePayload,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: this.truncateToolResultContentForContext(
              missingNamePayload,
              contextGuard.maxSingleToolResultChars,
              {
                sessionId: toolContext?.sessionId,
                toolName: "__missing_tool_name__",
                toolCallId: toolUseId,
              }
            ),
          });
          continue;
        }

        const executed = await (preStarted.get(toolUseId) ??
          this.executeToolWithHooks(toolName, args, allowedToolNames, toolContext, hookContext));
        const resultPayload =
          executed.result === undefined
            ? { error: `Tool execution skipped for ${toolName}` }
            : executed.result;
        if (!executed.skipped) {
          iterationToolCalls.push({
            name: toolName,
            args,
            result: resultPayload,
          });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars,
            {
              sessionId: toolContext?.sessionId,
              toolName,
              toolCallId: toolUseId,
            }
          ),
        });
      }

      const returnedToolUseIds = new Set(toolResults.map((toolResult) => toolResult.tool_use_id));
      for (const expectedId of expectedToolUseIds) {
        if (returnedToolUseIds.has(expectedId)) continue;
        toolResults.push({
          type: "tool_result",
          tool_use_id: expectedId,
          content: this.truncateToolResultContentForContext(
            { error: "Missing tool result synthesized by Cybara" },
            contextGuard.maxSingleToolResultChars,
            {
              sessionId: toolContext?.sessionId,
              toolName: "__missing_tool_result__",
              toolCallId: expectedId,
            }
          ),
        });
      }

      if (toolResults.length === 0) {
        console.warn("[Agent] Anthropic tool loop produced no tool results; stopping loop early");
        break;
      }
      if (iterationToolCalls.length === 0) {
        console.warn(
          "[Agent] Anthropic tool loop produced no executable tool calls; stopping early"
        );
        if (!finalContent.trim()) {
          finalContent = this.missingExecutableToolCallsMessage();
        }
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

      webResearchToolCalls += countWebResearchCalls(
        iterationToolCalls.map((toolCall) => toolCall.name)
      );
      const forceResearchSynthesis = webResearchBudgetReached(webResearchToolCalls);

      const toolResultIds = new Set(toolResults.map((toolResult) => toolResult.tool_use_id));
      const assistantLoopContent = toAnthropicReplayContentWithNormalizedToolUses(
        currentData.content,
        toolUseBlocks,
        toolResultIds
      );

      currentMessages.push({
        role: "assistant",
        content: assistantLoopContent,
      });
      const steeringText = this.consumeSteeringText(toolContext);
      currentMessages.push({
        role: "user",
        content: [
          ...toolResults,
          ...(steeringText ? [{ type: "text", text: steeringText }] : []),
          ...(forceResearchSynthesis
            ? [{ type: "text", text: WEB_RESEARCH_SYNTHESIS_INSTRUCTION }]
            : []),
        ],
      });

      this.compactAnthropicLoopMessagesForContext(
        currentMessages,
        contextGuard.contextBudgetChars,
        false,
        { model: modelId, toolContext }
      );

      const loopRequestBody: Record<string, unknown> = anthropicRequestBase(
        modelId,
        currentMessages,
        maxOutputTokens,
        vertex
      );

      if (systemMessage) {
        loopRequestBody.system = systemMessage.content;
      }

      if (!forceResearchSynthesis && tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          name: t.name,
          description: t.description || "",
          input_schema: t.input_schema || { type: "object", properties: {} },
        }));
      }

      const loopCached = applyAnthropicCacheControl(
        {
          system: loopRequestBody.system as string | undefined,
          messages: loopRequestBody.messages as AnthropicCacheRequest["messages"],
        },
        { strategy: "system_and_3", ttl: "1h" }
      );
      if (loopCached.system !== undefined) loopRequestBody.system = loopCached.system;
      loopRequestBody.messages = loopCached.messages;

      const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 520, 529]);
      const MAX_RETRIES = 3;
      let loopResponse: Response | null = null;
      let lastLoopError = "";
      let loopFatalError = false;
      const loopRequestStartedAt = performance.now();

      try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          loopResponse = await fetch(`${baseUrl}${anthropicEndpoint}`, {
            method: "POST",
            headers,
            body: JSON.stringify(loopRequestBody),
            signal: withLlmRequestTimeout(toolContext?.abortSignal),
          });

          if (loopResponse.ok) break;

          lastLoopError = await loopResponse.text();
          this.recordHttpRateLimit(loopResponse.status, loopResponse.headers, {
            providerId,
            providerType: providerConfig,
          });

          if (loopResponse.status === 400 && isContextOverflowError(lastLoopError)) {
            this.compactAnthropicLoopMessagesForContext(
              currentMessages,
              Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
              true,
              { model: modelId, toolContext }
            );
            const retryBody: Record<string, unknown> = {
              ...loopRequestBody,
              messages: currentMessages,
            };
            const retryResponse = await fetch(`${baseUrl}${anthropicEndpoint}`, {
              method: "POST",
              headers,
              body: JSON.stringify(retryBody),
              signal: withLlmRequestTimeout(toolContext?.abortSignal),
            });
            if (!retryResponse.ok) {
              loopFatalError = true;
              lastLoopError = await retryResponse.text();
              this.recordHttpRateLimit(retryResponse.status, retryResponse.headers, {
                providerId,
                providerType: providerConfig,
              });
              break;
            }
            loopResponse = retryResponse;
            break;
          }

          if (TRANSIENT_STATUS_CODES.has(loopResponse.status) && attempt < MAX_RETRIES) {
            const backoffMs =
              loopResponse.status === 429
                ? Math.min(this.parseRetryAfterMs(loopResponse.headers), 120_000)
                : Math.min(1000 * Math.pow(2, attempt), 8000);
            console.warn(
              `[Agent] Anthropic transient error ${loopResponse.status} on iteration ${iterations}, ` +
                `retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          loopFatalError = true;
          break;
        }
      } catch (fetchError) {
        console.error(`[Agent] Anthropic fetch error on iteration ${iterations}:`, fetchError);
        loopFatalError = true;
        lastLoopError = String(fetchError);
      }

      if (loopFatalError || !loopResponse || !loopResponse.ok) {
        const statusCode = loopResponse?.status ?? "unknown";
        console.warn(
          `[Agent] Anthropic API error ${statusCode} after ${MAX_RETRIES} retries on iteration ${iterations}. ` +
            `Gracefully stopping loop with ${allToolCalls.length} completed tool calls.`
        );
        if (!finalContent.trim()) {
          finalContent =
            "I encountered a temporary API error and couldn't complete my response. " +
            "The work I've done so far has been preserved. Please try again.";
        } else {
          finalContent +=
            "\n\n---\n*Note: I encountered a temporary API error and had to stop early. " +
            "The above represents partial progress.*";
        }
        break;
      }

      const responseData = (await loopResponse.json()) as AnthropicResponse;
      if (responseData.usage) {
        trackTokenUsage(
          modelId,
          providerConfig,
          baseUrl,
          responseData.usage.input_tokens || 0,
          responseData.usage.output_tokens || 0,
          Math.round(performance.now() - loopRequestStartedAt),
          {
            sessionId: sessionIdForVisibleTokenUsage(toolContext),
            cachedInputTokens: responseData.usage.cache_read_input_tokens || 0,
            cacheWriteTokens: responseData.usage.cache_creation_input_tokens || 0,
            firstTokenMs: Math.round(performance.now() - loopRequestStartedAt),
          }
        );
      }
      const latestText = responseData.content?.find((c3) => c3.type === "text")?.text;
      if (latestText) {
        finalContent = latestText;
      }
      currentData = responseData;
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
      content: sanitizeAssistantContent(finalContent),
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
    const maxOutputTokens = resolveModelMaxOutputTokens("openai", undefined, modelId);
    const contextWindowTokens = resolveModelContextWindowTokens("openai", undefined, modelId);
    const contextGuard = this.resolveContextGuardBudgets(contextWindowTokens);
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

    const data = await this.postOpenAIChatCompletions(
      baseUrl,
      headers,
      requestBody,
      "API error",
      toolContext?.abortSignal,
      { providerType: "openai" },
      { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
    );

    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    trackOpenAIResponseUsage(data, {
      model: modelId,
      provider: "openai",
      providerUrl: baseUrl,
      durationMs,
      sessionId: sessionIdForVisibleTokenUsage(toolContext),
    });

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
    let webResearchToolCalls = 0;
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

      const normalizedToolCalls = normalizeOpenAIToolCalls(message, iterations, allowedToolNames);
      if (normalizedToolCalls.length === 0) {
        break;
      }

      const progressThought = summarizeProgressThought(message.content);
      if (progressThought && progressThought !== lastProgressThought) {
        this.broadcastAgentStatus("thinking", toolContext, progressThought);
        lastProgressThought = progressThought;
      }

      console.log(
        `[Agent] OpenAI agentic loop iteration ${iterations}: ${normalizedToolCalls.length} tool calls`
      );

      const toolResults: Array<{
        tool_call_id: string;
        role: "tool";
        content: string;
      }> = [];
      const iterationToolCalls: AgentToolCallResult[] = [];

      for (const toolCall of normalizedToolCalls) {
        const toolName = toolCall.name;
        const toolCallId = toolCall.id;
        const args = toolCall.args;

        if (!toolName) {
          const missingNamePayload = { error: "Tool call missing tool name" };
          iterationToolCalls.push({
            name: "__missing_tool_name__",
            args,
            result: missingNamePayload,
          });
          toolResults.push({
            tool_call_id: toolCallId,
            role: "tool",
            content: this.truncateToolResultContentForContext(
              missingNamePayload,
              contextGuard.maxSingleToolResultChars,
              {
                sessionId: toolContext?.sessionId,
                toolName: "__missing_tool_name__",
                toolCallId,
              }
            ),
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
          executed.result === undefined
            ? { error: `Tool execution skipped for ${toolName}` }
            : executed.result;
        if (!executed.skipped) {
          iterationToolCalls.push({
            name: toolName,
            args,
            result: resultPayload,
          });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars,
            {
              sessionId: toolContext?.sessionId,
              toolName,
              toolCallId,
            }
          ),
        });
      }

      if (toolResults.length === 0) {
        console.warn("[Agent] OpenAI tool loop produced no tool results; stopping loop early");
        break;
      }
      if (iterationToolCalls.length === 0) {
        console.warn("[Agent] OpenAI tool loop produced no executable tool calls; stopping early");
        if (!finalContent.trim()) {
          finalContent = this.missingExecutableToolCallsMessage();
        }
        break;
      }

      webResearchToolCalls += countWebResearchCalls(
        iterationToolCalls.map((toolCall) => toolCall.name)
      );
      const forceResearchSynthesis = webResearchBudgetReached(webResearchToolCalls);

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

      currentMessages.push(
        toOpenAIReplayMessageWithNormalizedToolCalls(message, normalizedToolCalls)
      );
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }
      if (forceResearchSynthesis) {
        currentMessages.push({
          role: "user",
          content: WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
        });
      }
      const steeringText = this.consumeSteeringText(toolContext);
      if (steeringText) {
        currentMessages.push({ role: "user", content: steeringText });
      }
      this.compactOpenAILoopMessagesForContext(
        currentMessages,
        contextGuard.contextBudgetChars,
        false,
        { model: modelId, toolContext }
      );

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: maxOutputTokens,
      };

      if (!forceResearchSynthesis && tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.input_schema || { type: "object", properties: {} },
          },
        }));
        loopRequestBody.tool_choice = "auto";
      }

      let loopData: OpenAIResponse;
      const loopRequestStartedAt = performance.now();
      try {
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          loopRequestBody,
          "API error in agentic loop",
          toolContext?.abortSignal,
          { providerType: "openai" },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
      } catch (error) {
        const errorMessage = this.normalizeErrorMessage(error);
        if (!isContextOverflowError(errorMessage)) {
          throw error;
        }
        const compacted = this.compactOpenAILoopMessagesForContext(
          currentMessages,
          Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
          true,
          { model: modelId, toolContext }
        );
        if (!compacted) {
          throw error;
        }
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          {
            ...loopRequestBody,
            messages: currentMessages,
          },
          "API error in agentic loop",
          toolContext?.abortSignal,
          { providerType: "openai" },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
      }
      trackOpenAIResponseUsage(loopData, {
        model: modelId,
        provider: "openai",
        providerUrl: baseUrl,
        durationMs: Math.round(performance.now() - loopRequestStartedAt),
        sessionId: sessionIdForVisibleTokenUsage(toolContext),
      });
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
      content: sanitizeAssistantContent(finalContent),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }
}
