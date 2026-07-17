import {
  type ContentBlock as BedrockContentBlock,
  type Message as BedrockMessage,
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType as SmithyDocumentType } from "@smithy/types";
import type { AgentMessage } from "./agent";
import {
  type AgenticLoopState,
  type AgentToolCallResult,
  type GoogleContent,
  type GooglePart,
  type GoogleResponse,
  normalizeGoogleModelId,
  parseGoogleAuthHeaders,
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
import { AgentProviderCodexRuntime } from "./agent-provider-codex-runtime";
import { sessionIdForVisibleTokenUsage } from "./agent-provider-common-runtime";
import { hasAgentTransferEnvelope } from "./agent-transfer";
import type { ToolDefinition } from "./database";
import { classifyApiError } from "./error-classifier";
import { googleFunctionDeclaration } from "./llm/google-tool-schema";
import { bedrockUserContent, hasImages, toGoogleImagePart } from "./llm/image-blocks";
import { googleThinkingConfig, normalizeReasoningEffort } from "./llm/reasoning";
import { withLlmRequestTimeout } from "./llm/request-timeout";
import { trackTokenUsage } from "./llm/token-usage-tracking";
import { providerExceptionRetryDelayMs } from "./provider-retry";
import type { ToolContext } from "./tools/index";

export abstract class AgentProviderCloudRuntime extends AgentProviderCodexRuntime {
  protected async callGoogleGenerativeAI(
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

    const headers: Record<string, string> = vertex
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.trim()}`,
        }
      : parseGoogleAuthHeaders(auth, providerAuthType).headers;
    const normalizedModelId = normalizeGoogleModelId(modelId);

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const endpoint = `${normalizedBaseUrl}/models/${encodeURIComponent(normalizedModelId)}:generateContent`;
    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const loopRuntimeTracker = createAgenticLoopRuntimeTracker();
    let iterations = 0;
    let finalContent = "";
    let closingResponseRequested = false;
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
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        if (closingResponseRequested || allToolCalls.length === 0) {
          break;
        }
        contents.push({
          role: "user",
          parts: [{ text: agenticLoopClosingPrompt(limitReason, loopPolicy) }],
        });
        closingResponseRequested = true;
      } else {
        iterations++;
      }

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

      if (tools.length > 0 && !closingResponseRequested) {
        requestBody.tools = [
          {
            functionDeclarations: tools.map(googleFunctionDeclaration),
          },
        ];
      }

      const startTime = performance.now();
      let response: Response | null = null;
      let transientRetryCount = 0;
      let attemptedOAuthRefresh = false;
      while (true) {
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
            signal: withLlmRequestTimeout(toolContext?.abortSignal),
          });
        } catch (error) {
          const retryDelayMs = providerExceptionRetryDelayMs(
            error,
            transientRetryCount,
            toolContext?.abortSignal
          );
          if (retryDelayMs === undefined) throw error;
          transientRetryCount += 1;
          this.broadcastAgentStatus(
            "thinking",
            toolContext,
            `Provider connection interrupted; retrying (${transientRetryCount}/3)...`
          );
          await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
          continue;
        }

        if (response.ok) break;

        const errorText = await response.text();
        const rateLimitContext = { providerId, providerType: providerConfig };
        this.recordHttpRateLimit(response.status, response.headers, rateLimitContext, errorText);
        if (
          response.status === 401 &&
          !attemptedOAuthRefresh &&
          (await this.refreshProviderAuthorization(headers, rateLimitContext))
        ) {
          attemptedOAuthRefresh = true;
          this.broadcastAgentStatus(
            "thinking",
            toolContext,
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
        if (classifiedError.retryable && transientRetryCount < 3 && retryDelayMs <= 120_000) {
          transientRetryCount += 1;
          this.broadcastAgentStatus(
            "thinking",
            toolContext,
            classifiedError.category === "rate_limit"
              ? `Provider rate limited; retrying (${transientRetryCount}/3)...`
              : `Provider temporarily unavailable; retrying (${transientRetryCount}/3)...`
          );
          await this.waitForRetryDelay(retryDelayMs, toolContext?.abortSignal);
          continue;
        }
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
          routerRouteId: toolContext?.routerRouteId,
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
      if (closingResponseRequested) {
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
          hookContext,
          loopRuntimeTracker
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = evaluateNoProgressLoop(
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

      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );
      const lastToolResponse = toolResponses.at(-1)?.functionResponse;
      if (lastToolResponse && budgetWarning) {
        lastToolResponse.response = {
          ...lastToolResponse.response,
          _agent_budget: budgetWarning,
        };
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
      finalContent = applyAgenticLoopLimitMessage("google", limitReason, loopPolicy, finalContent);
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  protected resolveBedrockRegion(baseUrl?: string): string {
    if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
      const match = baseUrl.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/i);
      const region = match?.[1];
      if (typeof region === "string" && region && region !== "{region}") {
        return region;
      }
    }
    return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  }

  protected async callBedrockConverse(
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
    const loopRuntimeTracker = createAgenticLoopRuntimeTracker();
    let iterations = 0;
    let finalContent = "";
    let closingResponseRequested = false;
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
      limitReason = resolveAgenticLoopLimit(loopPolicy, iterations, loopRuntimeTracker);
      if (limitReason) {
        if (closingResponseRequested || allToolCalls.length === 0) {
          break;
        }
        conversation.push({
          role: "user",
          content: [{ text: agenticLoopClosingPrompt(limitReason, loopPolicy) }],
        });
        closingResponseRequested = true;
      } else {
        iterations++;
      }

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

      if (tools.length > 0 && !closingResponseRequested) {
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
            routerRouteId: toolContext?.routerRouteId,
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
      if (closingResponseRequested) {
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
          hookContext,
          loopRuntimeTracker
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
      if (hasAgentTransferEnvelope(iterationToolCalls)) {
        finalContent = "";
        break;
      }

      const noProgressStreak = updateNoProgressLoopState(loopState, iterationToolCalls);
      const loopEvaluation = evaluateNoProgressLoop(
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

      const budgetWarning = consumeAgenticLoopBudgetWarning(
        loopPolicy,
        iterations,
        loopRuntimeTracker
      );

      conversation.push({
        role: "assistant",
        content: outputContent,
      });
      const steeringText = this.consumeSteeringText(toolContext);
      conversation.push({
        role: "user",
        content: [
          ...toolResults,
          ...(budgetWarning ? [{ text: budgetWarning }] : []),
          ...(steeringText ? [{ text: steeringText }] : []),
        ],
      });
    }

    if (limitReason) {
      finalContent = applyAgenticLoopLimitMessage("bedrock", limitReason, loopPolicy, finalContent);
    }

    return {
      content: finalContent.trim(),
      tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }
}
