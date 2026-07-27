import type { AgentMessage } from "./agent";
import {
  resolveContextGuardBudgets,
  truncateToolResultContentForContext,
} from "./agent-context-guard";
import {
  type AgenticLoopState,
  type AgentToolCallResult,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  type OpenAICodexTurnResult,
  type OpenAICodexUsage,
  parseServerSentEvents,
  parseToolArguments,
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
import {
  appendAgentBudgetWarning,
  type ProviderRateLimitContext,
  sessionIdForVisibleTokenUsage,
  shouldNudgeSkillLearning,
} from "./agent-provider-common-runtime";
import { AgentProviderOpenAICompatRuntime } from "./agent-provider-openai-compat-runtime";
import { hasAgentTransferEnvelope } from "./agent-transfer";
import type { ToolDefinition } from "./database";
import { classifyApiError } from "./error-classifier";
import { compactCodexInputItemsForContext, sanitizeCodexInputItems } from "./llm/codex-context";
import { openAIResponsesUserContent } from "./llm/image-blocks";
import { codexFastModeServiceTier } from "../../shared/codex-fast-mode";
import { config } from "./config";
import { coerceReasoningEffort, normalizeReasoningEffort } from "./llm/reasoning";
import {
  createStreamWatchdog,
  resolveLlmWatchdogDefaults,
  type StreamWatchdog,
} from "./llm/stream-watchdog";
import { trackTokenUsage } from "./llm/token-usage-tracking";
import { isContextOverflowError } from "./llm/tool-transcript";
import {
  extractOpenAICodexAccountId,
  getOpenAICodexModelCandidates,
  shouldRetryOpenAICodexModel,
} from "./openai-codex-models";
import { providerExceptionRetryDelayMs, resolveProviderRetryPolicy } from "./provider-retry";
import { parseOpenAICodexJsonTurnResponse } from "./openai-codex-response";
import { broadcastTokenDelta } from "./status";
import type { ToolContext } from "./tools/index";

export abstract class AgentProviderCodexRuntime extends AgentProviderOpenAICompatRuntime {
  protected resolveOpenAICodexBaseUrl(baseUrl: string): string {
    const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "https://chatgpt.com/backend-api";
    if (trimmed.includes("api.openai.com")) return "https://chatgpt.com/backend-api";
    return trimmed;
  }

  protected resolveOpenAICodexResponsesUrl(baseUrl: string): string {
    const normalized = this.resolveOpenAICodexBaseUrl(baseUrl).replace(/\/+$/, "");
    if (normalized.endsWith("/codex/responses")) return normalized;
    if (normalized.endsWith("/codex")) return `${normalized}/responses`;
    return `${normalized}/codex/responses`;
  }

  protected buildOpenAICodexInputFromMessages(messages: AgentMessage[]): {
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

  protected buildOpenAICodexToolDefinitions(
    tools: ToolDefinition[]
  ): Array<Record<string, unknown>> {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema || { type: "object", properties: {} },
    }));
  }

  protected async parseOpenAICodexTurnResponse(
    response: Response,
    sessionId?: string,
    agentId?: string,
    watchdog?: StreamWatchdog,
    requestStartedAt?: number
  ): Promise<OpenAICodexTurnResult> {
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";

    if (contentType.includes("application/json")) {
      const json = (await response.json()) as Record<string, unknown>;
      return parseOpenAICodexJsonTurnResponse(json);
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

  protected async postOpenAICodexTurn(
    url: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    requestedModel: string,
    sessionId?: string,
    agentId?: string,
    signal?: AbortSignal,
    rateLimitContext?: ProviderRateLimitContext,
    transport: "codex" | "grok" = "codex"
  ): Promise<OpenAICodexTurnResult & { resolvedModel: string }> {
    const retryPolicy = resolveProviderRetryPolicy(rateLimitContext?.providerType);
    const candidates =
      transport === "codex" ? getOpenAICodexModelCandidates(requestedModel) : [requestedModel];
    let finalError = `${transport === "grok" ? "Grok Build" : "OpenAI Codex"} request failed`;

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const body = { ...requestBody, model: candidate };
      let attemptedOAuthRefresh = false;
      let transientRetryCount = 0;

      while (true) {
        const watchdog = createStreamWatchdog({
          ...resolveLlmWatchdogDefaults(url),
          callerSignal: signal,
          label: transport === "grok" ? "Grok Build" : "Codex",
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
            { sessionId, agentId },
            `Provider connection interrupted; retrying (${transientRetryCount}/${retryPolicy.maxRetries})...`
          );
          await this.waitForRetryDelay(retryDelayMs, signal);
          continue;
        }

        if (!response.ok) {
          watchdog.dispose();
          const errorText = await response.text();
          this.recordHttpRateLimit(response.status, response.headers, rateLimitContext, errorText);
          finalError = `API error: ${response.status} - ${errorText}`;
          if (
            response.status === 401 &&
            !attemptedOAuthRefresh &&
            (await this.refreshProviderAuthorization(headers, rateLimitContext))
          ) {
            attemptedOAuthRefresh = true;
            this.logProviderRetryStatus(
              { sessionId, agentId },
              "Provider session refreshed; continuing..."
            );
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
            transientRetryCount < retryPolicy.maxRetries &&
            retryDelayMs <= retryPolicy.maxDelayMs
          ) {
            transientRetryCount += 1;
            this.logProviderRetryStatus(
              { sessionId, agentId },
              classifiedError.category === "rate_limit"
                ? `Provider rate limited; retrying (${transientRetryCount}/${retryPolicy.maxRetries})...`
                : `Provider temporarily unavailable; retrying (${transientRetryCount}/${retryPolicy.maxRetries})...`
            );
            await this.waitForRetryDelay(retryDelayMs, signal);
            continue;
          }
          if (
            transport === "codex" &&
            index < candidates.length - 1 &&
            shouldRetryOpenAICodexModel(response.status, errorText)
          ) {
            console.warn(
              `[Agent] OpenAI Codex model ${candidate} unavailable, retrying with ${candidates[index + 1]}`
            );
            break;
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
    }

    throw new Error(finalError);
  }

  protected async callOpenAICodexResponses(
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
    transport: "codex" | "grok" = "codex"
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
  }> {
    const codexUrl =
      transport === "grok"
        ? `${baseUrl.replace(/\/+$/, "")}/responses`
        : this.resolveOpenAICodexResponsesUrl(baseUrl);
    const codexContextWindow =
      typeof contextWindowTokens === "number" && contextWindowTokens > 0
        ? contextWindowTokens
        : DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    const { contextBudgetChars: codexBudgetChars, maxSingleToolResultChars: codexMaxOutputChars } =
      resolveContextGuardBudgets(codexContextWindow);
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
    if (transport === "codex") {
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
    }

    this.broadcastAgentStatus("generating", toolContext, "Generating response...");

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopRuntimeTracker = createAgenticLoopRuntimeTracker();
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
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        if (closingResponseRequested || allToolCalls.length === 0) {
          break;
        }
        inputItems.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: agenticLoopClosingPrompt(limitReason, loopPolicy),
            },
          ],
        });
        closingResponseRequested = true;
      } else {
        iterations++;
      }

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
      const fastModeTier = codexFastModeServiceTier(config.getCodexFastMode(), activeModelId);
      if (fastModeTier) {
        requestBody.service_tier = fastModeTier;
      }
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
      const runCodexTurn = () => {
        const requestHeaders =
          transport === "grok"
            ? {
                ...headers,
                "x-grok-conv-id": toolContext?.sessionId || "",
                "x-grok-req-id": crypto.randomUUID(),
                "x-grok-model-override": activeModelId,
                "x-grok-session-id": toolContext?.sessionId || "",
                "x-grok-agent-id": toolContext?.agentId || "",
              }
            : headers;
        return this.postOpenAICodexTurn(
          codexUrl,
          requestHeaders,
          requestBody,
          activeModelId,
          toolContext?.suppressStreaming ? undefined : toolContext?.sessionId,
          toolContext?.agentId,
          toolContext?.abortSignal,
          { providerId, providerType: providerConfig },
          transport
        );
      };
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
            firstTokenMs: turn.firstTokenMs,
            routerRouteId: toolContext?.routerRouteId,
          }
        );
      }

      if (closingResponseRequested && turn.toolCalls.length > 0) {
        finalContent = turn.content.trim();
        break;
      }

      if (turn.toolCalls.length === 0) {
        if (turn.content.trim().length > 0) {
          if (
            !closingResponseRequested &&
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
          hookContext,
          loopRuntimeTracker
        );
        const resultPayload =
          executed.result === undefined ? { skipped: true, reason: "no result" } : executed.result;
        if (!executed.skipped) {
          const toolCallRecord = {
            id: toolCall.callId,
            name: toolCall.name,
            args: toolCall.args,
            result: resultPayload,
            duration: executed.durationMs,
          };
          allToolCalls.push(toolCallRecord);
          iterationToolCalls.push(toolCallRecord);
        }
        functionCallOutputs.push({
          type: "function_call_output",
          call_id: toolCall.callId,
          output: truncateToolResultContentForContext(resultPayload, codexMaxOutputChars, {
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = evaluateNoProgressLoop(
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

      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );
      const lastFunctionOutput = functionCallOutputs.at(-1);
      if (lastFunctionOutput && typeof lastFunctionOutput.output === "string") {
        lastFunctionOutput.output = appendAgentBudgetWarning(
          lastFunctionOutput.output,
          budgetWarning
        );
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
      finalContent = applyAgenticLoopLimitMessage(
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
}
