import type { AgentMessage } from "./agent";
import {
  compactOpenAILoopMessagesForContext,
  resolveContextGuardBudgets,
  truncateToolResultContentForContext,
} from "./agent-context-guard";
import {
  type AgenticLoopState,
  type AgentToolCallResult,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type OpenAIMessage,
  type OpenAIResponse,
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
  AgentProviderCommonRuntime,
  appendAgentBudgetWarning,
  sessionIdForVisibleTokenUsage,
} from "./agent-provider-common-runtime";
import { hasAgentTransferEnvelope } from "./agent-transfer";
import {
  countWebResearchCalls,
  WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
  webResearchBudgetReached,
} from "./agent-web-research";
import type { ToolDefinition } from "./database";
import { applyProviderApiKey } from "./llm/auth-headers";
import { hasImages, toOpenAIImageBlock } from "./llm/image-blocks";
import {
  isKimiCodeProvider,
  normalizeKimiAssistantToolMessage,
  normalizeKimiToolSchema,
} from "./llm/kimi-wire";
import { normalizeModelToolCalls } from "./llm/model-dialect";
import { trackOpenAIResponseUsage } from "./llm/openai-response-usage";
import {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  openAICompatReasoningParams,
} from "./llm/reasoning";
import {
  sanitizeAssistantContent,
  shouldUseMiniMaxReasoningSplit,
  toOpenAIReplayMessageWithNormalizedToolCalls,
} from "./llm/text-tool-calls";
import { isContextOverflowError } from "./llm/tool-transcript";
import { providers as providerCatalog, type ProviderType } from "./providers";
import type { ToolContext } from "./tools/index";

function toOpenAICompatMessage(
  message: AgentMessage,
  providerConfig: string | undefined
): Record<string, unknown> {
  if (message.role === "user" && hasImages(message.images)) {
    return {
      role: message.role,
      content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...message.images.map(toOpenAIImageBlock),
      ],
    };
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    const converted = {
      role: message.role,
      content: message.content || null,
      tool_calls: message.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    };
    return isKimiCodeProvider(providerConfig)
      ? normalizeKimiAssistantToolMessage(converted)
      : converted;
  }
  if (message.role === "tool" && message.tool_call_id) {
    return { role: message.role, content: message.content, tool_call_id: message.tool_call_id };
  }
  return { role: message.role, content: message.content };
}

function toOpenAICompatTool(
  tool: ToolDefinition,
  providerConfig: string | undefined
): Record<string, unknown> {
  const schema = tool.input_schema || { type: "object", properties: {} };
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: isKimiCodeProvider(providerConfig) ? normalizeKimiToolSchema(schema) : schema,
    },
  };
}

function openAIReasoningContent(message: OpenAIMessage): string {
  const candidates = [message.reasoning_content, message.reasoning, message.thinking];
  return candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
  ) ?? "";
}

export abstract class AgentProviderOpenAICompatRuntime extends AgentProviderCommonRuntime {
  protected async callOpenAICompatAPI(
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
    const contextGuard = resolveContextGuardBudgets(
      contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    );
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((message) => toOpenAICompatMessage(message, providerConfig)),
    };

    const openaiEffort = normalizeReasoningEffort(
      this.resolveModelParams(toolContext).reasoning_effort
    );
    const reasoningParams = openaiEffort
      ? openAICompatReasoningParams(
          providerConfig || "",
          coerceReasoningEffort(openaiEffort, providerConfig, modelId),
          modelId
        )
      : {};
    if (openaiEffort) {
      Object.assign(requestBody, reasoningParams);
    }
    if (isKimiCodeProvider(providerConfig) && toolContext?.sessionId) {
      requestBody.prompt_cache_key = toolContext.sessionId;
    }

    if (shouldUseMiniMaxReasoningSplit(providerConfig, modelId)) {
      requestBody.reasoning_split = true;
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((tool) => toOpenAICompatTool(tool, providerConfig));
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
      routerRouteId: toolContext?.routerRouteId,
    });

    if (!message) {
      throw new Error("No response from API");
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopRuntimeTracker = createAgenticLoopRuntimeTracker();
    let iterations = 0;
    const currentMessages = (requestBody.messages as Record<string, unknown>[]).map((message) => ({
      ...message,
    }));
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const allToolCalls: AgentToolCallResult[] = [];
    const thinkingParts: string[] = [];
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
      const reasoningContent = openAIReasoningContent(message);
      if (reasoningContent && thinkingParts.at(-1) !== reasoningContent) {
        thinkingParts.push(reasoningContent);
      }
      const nextIteration = iterations + 1;
      const normalizedToolCalls = normalizeModelToolCalls({
        provider: providerConfig || "openai-compatible",
        model: modelId,
        message,
        iteration: nextIteration,
        allowedToolNames,
      });
      if (normalizedToolCalls.length === 0) {
        finalContent = typeof message.content === "string" ? message.content : "";
        break;
      }
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        break;
      }
      iterations = nextIteration;

      const progressThought = summarizeProgressThought(reasoningContent || message.content);
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
            content: truncateToolResultContentForContext(
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
          hookContext,
          loopRuntimeTracker
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
          content: truncateToolResultContentForContext(
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      webResearchToolCalls += countWebResearchCalls(
        iterationToolCalls.map((toolCall) => toolCall.name)
      );
      const forceResearchSynthesis = webResearchBudgetReached(webResearchToolCalls);

      const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = evaluateNoProgressLoop(
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

      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );
      const lastToolResult = toolResults.at(-1);
      if (lastToolResult) {
        lastToolResult.content = appendAgentBudgetWarning(lastToolResult.content, budgetWarning);
      }

      const replayMessage = toOpenAIReplayMessageWithNormalizedToolCalls(
        message,
        normalizedToolCalls
      );
      currentMessages.push(
        isKimiCodeProvider(providerConfig)
          ? normalizeKimiAssistantToolMessage(replayMessage)
          : replayMessage
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
      compactOpenAILoopMessagesForContext(currentMessages, contextGuard.contextBudgetChars, false, {
        model: modelId,
        toolContext,
      });

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        ...reasoningParams,
      };
      if (isKimiCodeProvider(providerConfig) && toolContext?.sessionId) {
        loopRequestBody.prompt_cache_key = toolContext.sessionId;
      }
      if (shouldUseMiniMaxReasoningSplit(providerConfig, modelId)) {
        loopRequestBody.reasoning_split = true;
      }

      if (!forceResearchSynthesis && tools && Array.isArray(tools) && tools.length > 0) {
        loopRequestBody.tools = tools.map((tool) => toOpenAICompatTool(tool, providerConfig));
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
        const compacted = compactOpenAILoopMessagesForContext(
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
        routerRouteId: toolContext?.routerRouteId,
      });
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        console.warn("[Agent] Agentic loop got an empty completion; stopping loop");
        break;
      }
    }

    if (
      (!finalContent.trim() || Boolean(limitReason)) &&
      allToolCalls.length > 0 &&
      !hasAgentTransferEnvelope(allToolCalls)
    ) {
      console.warn("[Agent] Final content empty after tool loop; requesting a closing response");
      try {
        currentMessages.push({
          role: "user",
          content: limitReason
            ? agenticLoopClosingPrompt(limitReason, loopPolicy)
            : "Reply to the user now with your findings from the tool results above. Do not call any more tools.",
        });
        const nudgeBody: Record<string, unknown> = {
          model: modelId,
          messages: currentMessages,
          ...reasoningParams,
        };
        if (isKimiCodeProvider(providerConfig) && toolContext?.sessionId) {
          nudgeBody.prompt_cache_key = toolContext.sessionId;
        }
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
          routerRouteId: toolContext?.routerRouteId,
        });
        const nudgeContent = nudgeData.choices?.[0]?.message?.content;
        if (typeof nudgeContent === "string" && nudgeContent.trim()) finalContent = nudgeContent;
      } catch (error) {
        console.warn(`[Agent] Closing-response nudge failed: ${this.normalizeErrorMessage(error)}`);
      }
    }

    if (limitReason) {
      finalContent = applyAgenticLoopLimitMessage(
        providerConfig || "openai-compat",
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
