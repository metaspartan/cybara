import { isProviderRecoveryStatusLabel } from "../../shared/chat-status";
import type { AgentMessage } from "./agent";
import { type AgentHookContext, emitAgentHook } from "./agent-hooks";
import {
  type AgenticLoopPolicy,
  type AgentToolCallResult,
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type OpenAIResponse,
  parseAgentConfig,
  parseModelParams,
} from "./agent-internals";
import { resolveAgenticLoopPolicyFromConfig } from "./agent-loop-policy";
import { type AgenticLoopRuntimeTracker } from "./agent-loop-runtime";
import {
  resolveModelContextWindowTokens,
  resolveModelMaxOutputTokens,
  shouldPreferMaxCompletionTokens,
} from "./agent-model-limits";
import { executeAgentTool } from "./agent-tool-execution";
import { config } from "./config";
import type { Agent, Provider, ToolDefinition } from "./database";
import { classifyApiError } from "./error-classifier";
import {
  callCursorAgentTransport,
  callDevinAgentTransport,
  callGitLabDuoTransport,
} from "./llm/agent-provider-transports";
import { normalizeLlmTimeoutError, withLlmRequestTimeout } from "./llm/request-timeout";
import {
  getSessionTokenUsageSnapshot,
  trackEstimatedSessionTokenUsage,
} from "./llm/session-token-usage";
import { createStreamWatchdog, resolveLlmWatchdogDefaults } from "./llm/stream-watchdog";
import { consumeOpenAIChatStream } from "./llm/streaming-completions";
import { coalesceSystemMessages } from "./llm/system-messages";
import { hasTextToolCallMarkup, sanitizeAssistantContent } from "./llm/text-tool-calls";
import {
  compactOpenAIRequestMessagesForContext as compactOpenAIRequestMessages,
  isContextOverflowError,
} from "./llm/tool-transcript";
import { getPluginProviderContribution } from "./plugins/provider-registry";
import { validatePublicHttpUrl } from "./outbound-url-policy";
import {
  parseProviderRetryAfterMs,
  providerExceptionRetryDelayMs,
  providerRetryDelayMs,
  resolveProviderRetryPolicy,
} from "./provider-retry";
import {
  getDefaultModel,
  getProviderBaseUrl,
  providers as providerCatalog,
  providerManager,
  type ProviderType,
} from "./providers";
import { recordRateLimit } from "./rate-limit-tracker";
import { recordRateLimit as recordRouterRateLimit } from "./router";
import {
  type AgentStatus,
  broadcastStatus,
  broadcastTokenDelta,
  type StatusPayload,
} from "./status";
import type { ToolContext } from "./tools/index";

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

export function shouldNudgeSkillLearning(toolCalls: Array<{ name: string }>): boolean {
  if (config.get<boolean>("skill_learning_nudge_enabled") !== true) return false;
  if (config.get<boolean>("self_improving_skills_enabled") === false) return false;
  if (toolCalls.some((call) => call.name === "skill_save")) return false;
  const substantial = new Set(
    toolCalls.map((call) => call.name).filter((name) => !SKILL_NUDGE_TRIVIAL_TOOLS.has(name))
  );
  return substantial.size >= 4;
}

export function sessionIdForVisibleTokenUsage(toolContext?: ToolContext): string | undefined {
  if (toolContext?.suppressStreaming) return undefined;
  const sessionId = typeof toolContext?.sessionId === "string" ? toolContext.sessionId.trim() : "";
  return sessionId || undefined;
}

export function appendAgentBudgetWarning(content: string, warning?: string): string {
  return warning ? `${content}\n\n${warning}` : content;
}

export interface ProviderRateLimitContext {
  providerId?: string;
  providerType?: string;
  defaultRetryAfterMs?: number;
}

export interface AgentProviderResponse {
  content: string;
  thinking?: string;
  tool_calls?: AgentToolCallResult[];
}

export abstract class AgentProviderCommonRuntime {
  protected abstract get(id: string): Agent | undefined;

  protected abstract callOpenAICompatAPI(
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
  ): Promise<AgentProviderResponse>;

  protected abstract callOpenAICodexResponses(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    customHeaders?: Record<string, string>,
    providerConfig?: string,
    toolContext?: ToolContext,
    contextWindowTokens?: number,
    providerId?: string,
    transport?: "codex" | "grok"
  ): Promise<AgentProviderResponse>;

  protected abstract callGoogleGenerativeAI(
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
    vertex?: boolean
  ): Promise<AgentProviderResponse>;

  protected abstract callBedrockConverse(
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    providerConfig: string,
    maxOutputTokens: number,
    toolContext?: ToolContext,
    baseUrl?: string
  ): Promise<AgentProviderResponse>;

  protected abstract callAnthropicAPI(
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
    vertex?: boolean
  ): Promise<AgentProviderResponse>;

  protected resolveModelParams(toolContext?: ToolContext): Record<string, unknown> {
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

  protected resolveAgenticLoopPolicy(toolContext?: ToolContext): AgenticLoopPolicy {
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

  protected mergeHeaderToken(existing: string | undefined, token: string): string {
    const normalized = (existing || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!normalized.includes(token)) {
      normalized.push(token);
    }
    return normalized.join(", ");
  }

  protected buildHookContext(
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

  protected buildStatusPayload(
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

  protected broadcastAgentStatus(
    status: AgentStatus,
    toolContext?: ToolContext,
    detail?: string,
    extra?: Partial<StatusPayload>
  ): void {
    if (toolContext?.suppressStreaming) return;
    if (detail && isProviderRecoveryStatusLabel(detail)) {
      const sessionId = toolContext?.sessionId?.trim() || "unscoped";
      console.warn(`[Agent] ${detail} [session=${sessionId}]`);
      return;
    }
    broadcastStatus(this.buildStatusPayload(status, toolContext, detail, extra));
  }

  protected consumeSteeringText(toolContext?: ToolContext): string | null {
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

  protected normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
  }

  protected parseRetryAfterMs(headers: Headers, defaultRetryAfterMs = 60_000): number {
    return parseProviderRetryAfterMs(headers, defaultRetryAfterMs);
  }

  protected async waitForRetryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? new Error("Retry aborted"));
      };
      const timeout = setTimeout(finish, delayMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  protected async refreshProviderAuthorization(
    headers: Record<string, string>,
    context?: ProviderRateLimitContext
  ): Promise<string | undefined> {
    const providerId = context?.providerId?.trim();
    if (!providerId) return undefined;
    const authorizationKey = Object.keys(headers).find(
      (key) => key.toLowerCase() === "authorization"
    );
    if (!authorizationKey || !headers[authorizationKey]?.startsWith("Bearer ")) return undefined;
    const provider = providerManager.getWithCredentials(providerId);
    if (!provider?.refresh_token) return undefined;
    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(provider, {
      force: true,
    });
    const accessToken = refreshed?.access_token?.trim();
    if (!accessToken) return undefined;
    headers[authorizationKey] = `Bearer ${accessToken}`;
    return accessToken;
  }

  protected providerRetryDelayMs(status: number, headers: Headers, attempt: number): number {
    return providerRetryDelayMs(status, headers, attempt);
  }

  protected logProviderRetryStatus(
    streamContext: { sessionId?: string | null; agentId?: string | null } | undefined,
    detail: string
  ): void {
    const sessionId = streamContext?.sessionId?.trim() || "unscoped";
    console.warn(`[Agent] ${detail} [session=${sessionId}]`);
  }

  protected recordHttpRateLimit(
    status: number,
    headers: Headers,
    context?: ProviderRateLimitContext,
    body = ""
  ): void {
    if (status !== 429) return;
    if (classifyApiError({ status, body }).category === "overloaded") return;
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

  protected missingExecutableToolCallsMessage(): string {
    return "I stopped because the model produced tool calls without the required arguments.";
  }

  protected async executeToolWithHooks(
    toolName: string,
    args: Record<string, unknown>,
    allowedToolNames: Set<string>,
    toolContext: ToolContext | undefined,
    hookContext: AgentHookContext,
    runtimeTracker?: AgenticLoopRuntimeTracker
  ): Promise<{ skipped: boolean; result?: unknown }> {
    return await executeAgentTool({
      toolName,
      args,
      allowedToolNames,
      toolContext,
      hookContext,
      runtimeTracker,
      broadcastStatus: (status, context, detail, extra) =>
        this.broadcastAgentStatus(status, context, detail, extra),
    });
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

  protected async callLLMInternal(
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
      settings?: Record<string, unknown>;
    };
    const providerConfig = providerInfo.provider;
    const baseUrl = providerInfo.base_url || getProviderBaseUrl(providerConfig);
    const auth = providerInfo.api_key || providerInfo.access_token;
    const catalogProviderDefinition = providerCatalog[providerConfig as ProviderType] as
      | { api?: string; headers?: Record<string, string>; authType?: string }
      | undefined;
    const pluginProviderDefinition = getPluginProviderContribution(providerConfig);
    if (pluginProviderDefinition && !pluginProviderDefinition.allowPrivateEndpoint) {
      const validation = await validatePublicHttpUrl(baseUrl);
      if (!validation.valid) {
        throw new Error(`Plugin provider endpoint is not public: ${validation.error}`);
      }
    }
    const providerDefinition =
      catalogProviderDefinition ||
      (pluginProviderDefinition
        ? {
            api:
              pluginProviderDefinition.api === "anthropic-compatible"
                ? "anthropic-messages"
                : "openai-completions",
            authType: pluginProviderDefinition.authType === "none" ? "none" : "api_key",
          }
        : undefined);
    const providerAuthType = providerDefinition?.authType || "api_key";
    const requiresTokenAuth = providerAuthType !== "none" && providerAuthType !== "aws-sdk";

    if (requiresTokenAuth && !auth) {
      throw new Error("No API key available");
    }
    const resolvedAuth = auth || "";

    const modelId = model || pluginProviderDefinition?.models[0] || getDefaultModel(providerConfig);
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

    if (apiFamily === "cursor-agent") {
      return callCursorAgentTransport(providerInfo as Provider, modelId, messages, toolContext);
    }

    if (apiFamily === "devin-agent") {
      return callDevinAgentTransport(providerInfo as Provider, messages, toolContext);
    }

    if (apiFamily === "gitlab-duo") {
      return callGitLabDuoTransport(providerInfo as Provider, messages, toolContext);
    }

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

    if (apiFamily === "xai-grok-responses") {
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
        providerInfo.id,
        "grok"
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

    throw new Error(`Provider ${providerConfig} uses unsupported API family ${apiFamily}`);
  }

  protected compactOpenAIRequestMessagesForContext(
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

  protected shouldRetryWithMaxCompletionTokens(status: number, errorText: string): boolean {
    if (status !== 400) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes("max_tokens") &&
      normalized.includes("max_completion_tokens") &&
      (normalized.includes("unsupported parameter") || normalized.includes("not supported"))
    );
  }

  protected shouldRetryWithAutoToolChoice(
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

  protected toAutoToolChoiceRequestBody(
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

  protected toMaxCompletionTokensRequestBody(
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

  protected applyOpenAITokenLimit(
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

  protected getOpenAITokenLimitFromRequestBody(
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

  protected setOpenAITokenLimitOnRequestBody(
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

  protected estimateOpenAIRequestInputTokens(requestBody: Record<string, unknown>): number {
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

  protected resolveOpenAIRequestTokenLimit(
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

  protected reduceOpenAITokenLimitForContextRetry(
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

  protected async postOpenAIChatCompletions(
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
    let transientRetryCount = 0;
    const retryPolicy = resolveProviderRetryPolicy(rateLimitContext?.providerType);
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
          const normalized = normalizeLlmTimeoutError(error, signal);
          const retryDelayMs = providerExceptionRetryDelayMs(
            normalized,
            transientRetryCount,
            signal,
            Math.random,
            retryPolicy.maxRetries
          );
          if (retryDelayMs === undefined) throw normalized;
          transientRetryCount += 1;
          this.logProviderRetryStatus(
            streamContext,
            `Provider connection interrupted; retrying (${transientRetryCount}/${retryPolicy.maxRetries})...`
          );
          await this.waitForRetryDelay(retryDelayMs, signal);
          return post(body);
        }
      }

      const watchdog = createStreamWatchdog({
        ...resolveLlmWatchdogDefaults(baseUrl),
        callerSignal: signal,
        label: "chat.completions",
      });
      const requestStartedAt = performance.now();
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...body,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: watchdog.signal,
        });
      } catch (error) {
        watchdog.dispose();
        const normalized = watchdog.wrapError(error);
        const retryDelayMs = providerExceptionRetryDelayMs(
          normalized,
          transientRetryCount,
          signal,
          Math.random,
          retryPolicy.maxRetries
        );
        if (retryDelayMs === undefined) throw normalized;
        transientRetryCount += 1;
        this.logProviderRetryStatus(
          streamContext,
          `Provider connection interrupted; retrying (${transientRetryCount}/${retryPolicy.maxRetries})...`
        );
        await this.waitForRetryDelay(retryDelayMs, signal);
        return post(body);
      }
      try {
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
    let attemptedOAuthRefresh = false;
    const maxTransientRetries = retryPolicy.maxRetries;
    const maxRetryDelayMs = retryPolicy.maxDelayMs;

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
      this.recordHttpRateLimit(response.status, response.headers, rateLimitContext, errorText);
      if (
        response.status === 401 &&
        !attemptedOAuthRefresh &&
        (await this.refreshProviderAuthorization(headers, rateLimitContext))
      ) {
        attemptedOAuthRefresh = true;
        this.logProviderRetryStatus(streamContext, "Provider session refreshed; continuing...");
        continue;
      }
      const classifiedError = classifyApiError({ status: response.status, body: errorText });
      const retryDelayMs = this.providerRetryDelayMs(
        response.status,
        response.headers,
        transientRetryCount
      );
      if (
        classifiedError.retryable &&
        transientRetryCount < maxTransientRetries &&
        retryDelayMs <= maxRetryDelayMs
      ) {
        transientRetryCount += 1;
        this.logProviderRetryStatus(
          streamContext,
          response.status === 429
            ? `Provider rate limited; retrying (${transientRetryCount}/${maxTransientRetries})...`
            : `Provider temporarily unavailable; retrying (${transientRetryCount}/${maxTransientRetries})...`
        );
        await this.waitForRetryDelay(retryDelayMs, signal);
        continue;
      }
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
}
