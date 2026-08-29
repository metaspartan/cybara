import type { AgentMessage } from "./agent";
import {
  compactOpenAILoopMessagesForContext,
  resolveContextGuardBudgets,
  truncateToolResultContentForContext,
} from "./agent-context-guard";
import {
  type AgenticLoopState,
  type AgentToolCallResult,
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
import { resolveModelContextWindowTokens, resolveModelMaxOutputTokens } from "./agent-model-limits";
import { AgentProviderAnthropicRuntime } from "./agent-provider-anthropic-runtime";
import {
  appendAgentBudgetWarning,
  sessionIdForVisibleTokenUsage,
} from "./agent-provider-common-runtime";
import { hasAgentTransferEnvelope } from "./agent-transfer";
import { openAIImageToolFollowup } from "./agent-tool-images";
import {
  countWebResearchCalls,
  toolsAfterWebResearchBudget,
  WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
  webResearchBudgetReached,
} from "./agent-web-research";
import type { ToolDefinition } from "./database";
import { normalizeModelToolCalls } from "./llm/model-dialect";
import { trackOpenAIResponseUsage } from "./llm/openai-response-usage";
import { canRunToolsInParallel } from "./llm/parallel-tools";
import { toOpenAIChatHistory } from "./llm/provider-history";
import {
  sanitizeAssistantContent,
  toOpenAIReplayMessageWithNormalizedToolCalls,
} from "./llm/text-tool-calls";
import { isContextOverflowError } from "./llm/tool-transcript";
import type { ToolContext } from "./tools/index";

export abstract class AgentProviderRuntime extends AgentProviderAnthropicRuntime {
  protected async callOpenAIAPI(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolContext?: ToolContext
  ): Promise<{ content: string; tool_calls?: AgentToolCallResult[] }> {
    const maxOutputTokens = resolveModelMaxOutputTokens("openai", undefined, modelId);
    const contextWindowTokens = resolveModelContextWindowTokens("openai", undefined, modelId);
    const contextGuard = resolveContextGuardBudgets(contextWindowTokens);
    const chatMessages = toOpenAIChatHistory(messages);

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
      inputTokens: this.estimateOpenAIRequestInputTokens(requestBody),

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
    const currentMessages: Record<string, unknown>[] = [...chatMessages];
    const allowedToolNames = new Set(tools.map((tool) => tool.name));
    const allToolCalls: AgentToolCallResult[] = [];
    let finalContent = message.content || "";
    let lastProgressThought = "";
    let webResearchToolCalls = 0;
    let webResearchExhausted = false;
    const hookContext = this.buildHookContext("openai", modelId, toolContext);
    const loopState: AgenticLoopState = {
      previousFingerprint: undefined,
      noProgressStreak: 0,
      warningBucket: -1,
    };
    let limitReason: "maxIterations" | "runtime" | undefined;

    while (true) {
      const nextIteration = iterations + 1;
      const normalizedToolCalls = normalizeModelToolCalls({
        provider: "openai",
        model: modelId,
        message,
        iteration: nextIteration,
        allowedToolNames,
      });
      if (normalizedToolCalls.length === 0) {
        finalContent = message.content || finalContent;
        break;
      }
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        break;
      }
      iterations = nextIteration;

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

      const preStarted = new Map<string, ReturnType<typeof this.executeToolWithHooks>>();
      if (canRunToolsInParallel(normalizedToolCalls.map((toolCall) => toolCall.name))) {
        for (const toolCall of normalizedToolCalls) {
          if (toolCall.id && toolCall.name) {
            preStarted.set(
              toolCall.id,
              this.executeToolWithHooks(
                toolCall.name,
                toolCall.args,
                allowedToolNames,
                toolContext,
                hookContext,
                loopRuntimeTracker
              )
            );
          }
        }
      }

      for (const toolCall of normalizedToolCalls) {
        const toolName = toolCall.name;
        const toolCallId = toolCall.id;
        const args = toolCall.args;

        if (!toolName) {
          const missingNamePayload = { error: "Tool call missing tool name" };
          iterationToolCalls.push({
            id: toolCallId,
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
        const executed = await (preStarted.get(toolCallId) ??
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
            id: toolCallId,
            name: toolName,
            args,
            result: resultPayload,
            duration: executed.durationMs,
          });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({
            id: toolCallId,
            name: toolName,
            args,
            result: executed.result,
            duration: executed.durationMs,
          });
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      webResearchToolCalls += countWebResearchCalls(
        iterationToolCalls.map((toolCall) => toolCall.name)
      );
      const reachedWebResearchBudget = webResearchBudgetReached(webResearchToolCalls);
      const notifyWebResearchBudget = reachedWebResearchBudget && !webResearchExhausted;
      webResearchExhausted ||= reachedWebResearchBudget;

      const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = evaluateNoProgressLoop(
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

      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );
      const lastToolResult = toolResults.at(-1);
      if (lastToolResult) {
        lastToolResult.content = appendAgentBudgetWarning(lastToolResult.content, budgetWarning);
      }

      currentMessages.push(
        toOpenAIReplayMessageWithNormalizedToolCalls(message, normalizedToolCalls)
      );
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }
      const imageFollowup = await openAIImageToolFollowup(iterationToolCalls);
      if (imageFollowup) currentMessages.push(imageFollowup);
      if (notifyWebResearchBudget) {
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
        max_tokens: maxOutputTokens,
      };

      const loopTools = toolsAfterWebResearchBudget(tools, webResearchExhausted);
      if (loopTools.length > 0) {
        loopRequestBody.tools = loopTools.map((t) => ({
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
        const compacted = compactOpenAILoopMessagesForContext(
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
        inputTokens: this.estimateOpenAIRequestInputTokens(loopRequestBody),

        providerUrl: baseUrl,
        durationMs: Math.round(performance.now() - loopRequestStartedAt),
        sessionId: sessionIdForVisibleTokenUsage(toolContext),
        routerRouteId: toolContext?.routerRouteId,
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

    if (limitReason && allToolCalls.length > 0 && !hasAgentTransferEnvelope(allToolCalls)) {
      try {
        currentMessages.push({
          role: "user",
          content: agenticLoopClosingPrompt(limitReason, loopPolicy),
        });
        const closingBody: Record<string, unknown> = {
          model: modelId,
          messages: currentMessages,
          max_tokens: maxOutputTokens,
        };
        const closingStartedAt = performance.now();
        const closingData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          closingBody,
          "API error in agentic loop closing response",
          toolContext?.abortSignal,
          { providerType: "openai" },
          { sessionId: sessionIdForVisibleTokenUsage(toolContext) }
        );
        trackOpenAIResponseUsage(closingData, {
          model: modelId,
          provider: "openai",
          inputTokens: this.estimateOpenAIRequestInputTokens(closingBody),

          providerUrl: baseUrl,
          durationMs: Math.round(performance.now() - closingStartedAt),
          sessionId: sessionIdForVisibleTokenUsage(toolContext),
          routerRouteId: toolContext?.routerRouteId,
        });
        const closingContent = closingData.choices?.[0]?.message?.content;
        if (typeof closingContent === "string" && closingContent.trim()) {
          finalContent = closingContent;
        }
      } catch (error) {
        console.warn(
          `[Agent] OpenAI closing response failed: ${this.normalizeErrorMessage(error)}`
        );
      }
    }

    if (limitReason) {
      finalContent = applyAgenticLoopLimitMessage("openai", limitReason, loopPolicy, finalContent);
    }

    return {
      content: sanitizeAssistantContent(finalContent),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }
}
