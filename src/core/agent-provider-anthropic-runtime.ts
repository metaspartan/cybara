import type { AgentMessage } from "./agent";
import {
  compactAnthropicLoopMessagesForContext,
  resolveContextGuardBudgets,
  truncateToolResultContentForContext,
} from "./agent-context-guard";
import {
  type AgenticLoopState,
  type AgentToolCallResult,
  ANTHROPIC_CONTEXT_1M_BETA,
  type AnthropicResponse,
  type AnthropicUsage,
  summarizeProgressThought,
} from "./agent-internals";
import {
  agenticLoopClosingPrompt,
  applyAgenticLoopLimitMessage,
  consumeAgenticLoopBudgetWarning,
  createAgenticLoopRuntimeTracker,
  evaluateNoProgressLoop,
  resolveAgenticLoopLimit,
  updateNoProgressLoopState,
} from "./agent-loop-runtime";
import { resolveModelContextWindowTokens } from "./agent-model-limits";
import { AgentProviderCloudRuntime } from "./agent-provider-cloud-runtime";
import {
  appendAgentBudgetWarning,
  sessionIdForVisibleTokenUsage,
} from "./agent-provider-common-runtime";
import { hasAgentTransferEnvelope } from "./agent-transfer";
import {
  countWebResearchCalls,
  WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
  webResearchBudgetReached,
} from "./agent-web-research";
import {
  acquireCredential,
  markCredentialCooldown,
  markCredentialHealthy,
  msUntilAnyAvailable,
  type PooledCredential,
  poolSize,
} from "./credential-pool";
import type { ToolDefinition } from "./database";
import { classifyApiError } from "./error-classifier";
import {
  anthropicEndpointPath,
  anthropicRequestBase,
  anthropicRequestHeaders,
} from "./llm/anthropic-vertex";
import { normalizeAnthropicModelToolUses } from "./llm/model-dialect";
import { canRunToolsInParallel } from "./llm/parallel-tools";
import { toAnthropicHistory } from "./llm/provider-history";
import { supportsForcedToolChoice } from "./llm/provider-model-transport";
import {
  applyAnthropicReasoningOptions,
  collectAnthropicThinkingText,
  resolveAnthropicToolChoice,
  shouldSendAnthropicContext1mBeta,
} from "./llm/anthropic-request-options";
import { withLlmRequestTimeout } from "./llm/request-timeout";
import { normalizeProviderTokenUsage } from "./llm/token-usage-normalization";
import {
  sanitizeAssistantContent,
  toAnthropicReplayContentWithNormalizedToolUses,
} from "./llm/text-tool-calls";
import { trackTokenUsage } from "./llm/token-usage-tracking";
import { isContextOverflowError } from "./llm/tool-transcript";
import { type AnthropicCacheRequest, applyAnthropicCacheControl } from "./prompt-cache";
import { boundedPoolRetryDelayMs, providerExceptionRetryDelayMs } from "./provider-retry";
import { providers as providerCatalog, type ProviderType } from "./providers";
import { recordRateLimit } from "./rate-limit-tracker";
import type { ToolContext } from "./tools/index";

function normalizeAnthropicUsage(usage: AnthropicUsage) {
  return normalizeProviderTokenUsage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    cacheTokenAccounting: "separate",
  });
}

export abstract class AgentProviderAnthropicRuntime extends AgentProviderCloudRuntime {
  protected async callAnthropicAPI(
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
    const chatMessages = toAnthropicHistory(messages);

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

    applyAnthropicReasoningOptions(
      requestBody,
      providerConfig,
      modelId,
      maxOutputTokens,
      modelParams
    );

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.input_schema || { type: "object", properties: {} },
      }));
      requestBody.tool_choice = resolveAnthropicToolChoice(
        tools.map((tool) => tool.name),
        supportsForcedToolChoice(providerConfig) ? toolContext : undefined
      );
    }

    const oauth = providerCatalog[providerConfig as ProviderType]?.authType === "oauth";
    const headers: Record<string, string> = anthropicRequestHeaders(auth, vertex, oauth);

    if (!vertex && shouldSendAnthropicContext1mBeta(modelId, modelParams?.context1m === true)) {
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
    const INITIAL_MAX_RETRIES = 3;
    let response: Response | null = null;
    let lastInitialError = "";
    let initialRetryCount = 0;
    let attemptedInitialOAuthRefresh = false;
    const poolName = providerConfig === "anthropic" ? "anthropic" : providerConfig;
    let activeCredential: PooledCredential | null =
      !vertex && !oauth && poolSize(poolName) > 0 ? acquireCredential(poolName) : null;
    let currentApiKey = activeCredential?.value ?? auth;

    while (initialRetryCount <= INITIAL_MAX_RETRIES) {
      if (vertex) {
        headers.Authorization = `Bearer ${currentApiKey}`;
      } else if (oauth) {
        headers.Authorization = `Bearer ${currentApiKey}`;
      } else {
        headers["x-api-key"] = currentApiKey;
      }
      try {
        response = await fetch(`${baseUrl}${anthropicEndpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: withLlmRequestTimeout(toolContext?.abortSignal),
        });
      } catch (error) {
        const retryDelayMs = providerExceptionRetryDelayMs(
          error,
          initialRetryCount,
          toolContext?.abortSignal
        );
        if (retryDelayMs === undefined) throw error;
        initialRetryCount += 1;
        this.broadcastAgentStatus(
          "thinking",
          toolContext,
          `Provider connection interrupted; retrying (${initialRetryCount}/${INITIAL_MAX_RETRIES})...`
        );
        await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
        continue;
      }

      if (response.ok) {
        if (activeCredential) markCredentialHealthy(poolName, activeCredential);
        break;
      }

      lastInitialError = await response.text();

      const classifiedError = classifyApiError({ status: response.status, body: lastInitialError });
      if (activeCredential && classifiedError.category === "rate_limit") {
        recordRateLimit(activeCredential.label, response.headers);
      }
      this.recordHttpRateLimit(
        response.status,
        response.headers,
        {
          providerId,
          providerType: providerConfig,
        },
        lastInitialError
      );

      if (response.status === 401 && oauth && !attemptedInitialOAuthRefresh) {
        const refreshedToken = await this.refreshProviderAuthorization(headers, {
          providerId,
          providerType: providerConfig,
        });
        if (refreshedToken) {
          attemptedInitialOAuthRefresh = true;
          currentApiKey = refreshedToken;
          this.broadcastAgentStatus(
            "thinking",
            toolContext,
            "Provider session refreshed; continuing..."
          );
          continue;
        }
      }

      const retryDelayMs = this.providerRetryDelayMs(
        response.status,
        response.headers,
        initialRetryCount
      );
      if (
        classifiedError.retryable &&
        initialRetryCount < INITIAL_MAX_RETRIES &&
        retryDelayMs <= 120_000
      ) {
        if (classifiedError.category === "rate_limit" && activeCredential) {
          markCredentialCooldown(poolName, activeCredential, "rate_limit");
        }
        const rotated =
          classifiedError.rotateCredential && !vertex && !oauth && poolSize(poolName) > 0
            ? acquireCredential(poolName)
            : null;
        if (rotated) {
          activeCredential = rotated;
          currentApiKey = rotated.value;
        }
        initialRetryCount += 1;
        const backoffMs =
          classifiedError.category === "rate_limit"
            ? boundedPoolRetryDelayMs(msUntilAnyAvailable(poolName), retryDelayMs)
            : retryDelayMs;
        console.warn(
          `[Agent] Anthropic transient error ${response.status} on initial call, ` +
            `retrying in ${backoffMs}ms (attempt ${initialRetryCount}/${INITIAL_MAX_RETRIES})...`
        );
        this.broadcastAgentStatus(
          "thinking",
          toolContext,
          classifiedError.category === "rate_limit"
            ? `Provider rate limited; retrying (${initialRetryCount}/${INITIAL_MAX_RETRIES})...`
            : `Provider temporarily unavailable; retrying (${initialRetryCount}/${INITIAL_MAX_RETRIES})...`
        );
        await this.waitForRetryDelay(backoffMs, toolContext?.abortSignal);
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
      const usage = normalizeAnthropicUsage(data.usage);
      trackTokenUsage(
        modelId,
        providerConfig,
        baseUrl,
        usage.inputTokens,
        usage.outputTokens,
        durationMs,
        {
          sessionId: sessionIdForVisibleTokenUsage(toolContext),
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          routerRouteId: toolContext?.routerRouteId,
        }
      );
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const contextWindowTokens = resolveModelContextWindowTokens(
      providerConfig,
      providerId,
      modelId
    );
    const contextGuard = resolveContextGuardBudgets(contextWindowTokens);
    const loopRuntimeTracker = createAgenticLoopRuntimeTracker();
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
    const thinkingParts = collectAnthropicThinkingText(currentData.content);
    const hookContext = this.buildHookContext(providerConfig, modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      const nextIteration = iterations + 1;
      const toolUseBlocks = normalizeAnthropicModelToolUses({
        provider: providerConfig,
        model: modelId,
        content: currentData.content,
        iteration: nextIteration,
        allowedToolNames,
      });

      if (toolUseBlocks.length === 0) {
        break;
      }
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        break;
      }
      iterations = nextIteration;

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
                hookContext,
                loopRuntimeTracker
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
            id: toolUseId,
            name: "__missing_tool_name__",
            args,
            result: missingNamePayload,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: truncateToolResultContentForContext(
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
          this.executeToolWithHooks(
            toolName,
            args,
            allowedToolNames,
            toolContext,
            hookContext,
            loopRuntimeTracker
          ));
        const resultPayload =
          executed.result === undefined
            ? { error: `Tool execution skipped for ${toolName}` }
            : executed.result;
        if (!executed.skipped) {
          iterationToolCalls.push({
            id: toolUseId,
            name: toolName,
            args,
            result: resultPayload,
            duration: executed.durationMs,
          });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({
            id: toolUseId,
            name: toolName,
            args,
            result: executed.result,
            duration: executed.durationMs,
          });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: truncateToolResultContentForContext(
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
          content: truncateToolResultContentForContext(
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      if (iterationToolCalls.length > 0) {
        const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
        const loopEvaluation = evaluateNoProgressLoop(
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
      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );
      const lastToolResult = toolResults.at(-1);
      if (lastToolResult) {
        lastToolResult.content = appendAgentBudgetWarning(lastToolResult.content, budgetWarning);
      }

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

      compactAnthropicLoopMessagesForContext(
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

      applyAnthropicReasoningOptions(
        loopRequestBody,
        providerConfig,
        modelId,
        maxOutputTokens,
        modelParams
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
        loopRequestBody.tool_choice = resolveAnthropicToolChoice(tools.map((tool) => tool.name));
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

      const MAX_RETRIES = 3;
      let loopResponse: Response | null = null;
      let lastLoopError = "";
      let loopFatalError = false;
      let loopRetryCount = 0;
      let attemptedLoopOAuthRefresh = false;
      const loopRequestStartedAt = performance.now();

      try {
        while (loopRetryCount <= MAX_RETRIES) {
          try {
            loopResponse = await fetch(`${baseUrl}${anthropicEndpoint}`, {
              method: "POST",
              headers,
              body: JSON.stringify(loopRequestBody),
              signal: withLlmRequestTimeout(toolContext?.abortSignal),
            });
          } catch (error) {
            const retryDelayMs = providerExceptionRetryDelayMs(
              error,
              loopRetryCount,
              toolContext?.abortSignal
            );
            if (retryDelayMs === undefined) throw error;
            loopRetryCount += 1;
            this.broadcastAgentStatus(
              "thinking",
              toolContext,
              `Provider connection interrupted; retrying (${loopRetryCount}/${MAX_RETRIES})...`
            );
            await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
            continue;
          }

          if (loopResponse.ok) break;

          lastLoopError = await loopResponse.text();
          this.recordHttpRateLimit(
            loopResponse.status,
            loopResponse.headers,
            {
              providerId,
              providerType: providerConfig,
            },
            lastLoopError
          );

          if (loopResponse.status === 400 && isContextOverflowError(lastLoopError)) {
            compactAnthropicLoopMessagesForContext(
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
              this.recordHttpRateLimit(
                retryResponse.status,
                retryResponse.headers,
                {
                  providerId,
                  providerType: providerConfig,
                },
                lastLoopError
              );
              break;
            }
            loopResponse = retryResponse;
            break;
          }

          if (loopResponse.status === 401 && oauth && !attemptedLoopOAuthRefresh) {
            const refreshedToken = await this.refreshProviderAuthorization(headers, {
              providerId,
              providerType: providerConfig,
            });
            if (refreshedToken) {
              attemptedLoopOAuthRefresh = true;
              currentApiKey = refreshedToken;
              this.broadcastAgentStatus(
                "thinking",
                toolContext,
                "Provider session refreshed; continuing..."
              );
              continue;
            }
          }

          const classifiedError = classifyApiError({
            status: loopResponse.status,
            body: lastLoopError,
          });
          const retryDelayMs = this.providerRetryDelayMs(
            loopResponse.status,
            loopResponse.headers,
            loopRetryCount
          );
          if (
            classifiedError.retryable &&
            loopRetryCount < MAX_RETRIES &&
            retryDelayMs <= 120_000
          ) {
            loopRetryCount += 1;
            console.warn(
              `[Agent] Anthropic transient error ${loopResponse.status} on iteration ${iterations}, ` +
                `retrying in ${retryDelayMs}ms (attempt ${loopRetryCount}/${MAX_RETRIES})...`
            );
            this.broadcastAgentStatus(
              "thinking",
              toolContext,
              classifiedError.category === "rate_limit"
                ? `Provider rate limited; retrying (${loopRetryCount}/${MAX_RETRIES})...`
                : `Provider temporarily unavailable; retrying (${loopRetryCount}/${MAX_RETRIES})...`
            );
            await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
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
      thinkingParts.push(...collectAnthropicThinkingText(responseData.content));
      if (responseData.usage) {
        const usage = normalizeAnthropicUsage(responseData.usage);
        trackTokenUsage(
          modelId,
          providerConfig,
          baseUrl,
          usage.inputTokens,
          usage.outputTokens,
          Math.round(performance.now() - loopRequestStartedAt),
          {
            sessionId: sessionIdForVisibleTokenUsage(toolContext),
            cachedInputTokens: usage.cachedInputTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            routerRouteId: toolContext?.routerRouteId,
          }
        );
      }
      const latestText = responseData.content?.find((c3) => c3.type === "text")?.text;
      if (latestText) {
        finalContent = latestText;
      }
      currentData = responseData;
    }

    if (limitReason && allToolCalls.length > 0 && !hasAgentTransferEnvelope(allToolCalls)) {
      try {
        currentMessages.push({
          role: "user",
          content: agenticLoopClosingPrompt(limitReason, loopPolicy),
        });
        const closingBody: Record<string, unknown> = anthropicRequestBase(
          modelId,
          currentMessages,
          maxOutputTokens,
          vertex
        );
        applyAnthropicReasoningOptions(
          closingBody,
          providerConfig,
          modelId,
          maxOutputTokens,
          modelParams
        );
        if (systemMessage) {
          closingBody.system = systemMessage.content;
        }
        const closingStartedAt = performance.now();
        let closingResponse: Response | null = null;
        let closingRetryCount = 0;
        let attemptedClosingOAuthRefresh = false;
        while (true) {
          try {
            closingResponse = await fetch(`${baseUrl}${anthropicEndpoint}`, {
              method: "POST",
              headers,
              body: JSON.stringify(closingBody),
              signal: withLlmRequestTimeout(toolContext?.abortSignal),
            });
          } catch (error) {
            const retryDelayMs = providerExceptionRetryDelayMs(
              error,
              closingRetryCount,
              toolContext?.abortSignal
            );
            if (retryDelayMs === undefined) throw error;
            closingRetryCount += 1;
            await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
            continue;
          }
          if (closingResponse.ok) break;
          const errorText = await closingResponse.text();
          const rateLimitContext = { providerId, providerType: providerConfig };
          this.recordHttpRateLimit(
            closingResponse.status,
            closingResponse.headers,
            rateLimitContext,
            errorText
          );
          if (
            closingResponse.status === 401 &&
            oauth &&
            !attemptedClosingOAuthRefresh &&
            (await this.refreshProviderAuthorization(headers, rateLimitContext))
          ) {
            attemptedClosingOAuthRefresh = true;
            this.broadcastAgentStatus(
              "thinking",
              toolContext,
              "Provider session refreshed; continuing..."
            );
            continue;
          }
          const classifiedError = classifyApiError({
            status: closingResponse.status,
            body: errorText,
          });
          const retryDelayMs = this.providerRetryDelayMs(
            closingResponse.status,
            closingResponse.headers,
            closingRetryCount
          );
          if (classifiedError.retryable && closingRetryCount < 3 && retryDelayMs <= 120_000) {
            closingRetryCount += 1;
            await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
            continue;
          }
          throw new Error(`API error: ${closingResponse.status} - ${errorText}`);
        }
        if (closingResponse.ok) {
          const closingData = (await closingResponse.json()) as AnthropicResponse;
          thinkingParts.push(...collectAnthropicThinkingText(closingData.content));
          if (closingData.usage) {
            const usage = normalizeAnthropicUsage(closingData.usage);
            trackTokenUsage(
              modelId,
              providerConfig,
              baseUrl,
              usage.inputTokens,
              usage.outputTokens,
              Math.round(performance.now() - closingStartedAt),
              {
                sessionId: sessionIdForVisibleTokenUsage(toolContext),
                cachedInputTokens: usage.cachedInputTokens,
                cacheWriteTokens: usage.cacheWriteTokens,
                routerRouteId: toolContext?.routerRouteId,
              }
            );
          }
          const closingText = closingData.content?.find((part) => part.type === "text")?.text;
          if (closingText?.trim()) {
            finalContent = closingText;
          }
        } else {
          console.warn(`[Agent] Anthropic closing response failed with ${closingResponse.status}`);
        }
      } catch (error) {
        console.warn(
          `[Agent] Anthropic closing response failed: ${this.normalizeErrorMessage(error)}`
        );
      }
    }

    if (limitReason) {
      finalContent = applyAgenticLoopLimitMessage(
        "anthropic",
        limitReason,
        loopPolicy,
        finalContent
      );
    }

    return {
      content: sanitizeAssistantContent(finalContent),
      thinking: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : undefined,
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }
}
