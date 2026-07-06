import { tables, type Agent, type ToolDefinition } from "./database";
import { config } from "./config";
import {
  providerManager,
  getProviderBaseUrl,
  getDefaultModel,
  providers as providerCatalog,
  type ProviderType,
} from "./providers";
import { getToolSchemasForLLM, isToolEnabledForAgent, type ToolContext } from "./tools/index";
import {
  acquireCredential,
  markCredentialCooldown,
  markCredentialHealthy,
  msUntilAnyAvailable,
  poolSize,
  registerCredentialsFromEnv,
  type PooledCredential,
} from "./credential-pool";
import { recordRateLimit } from "./rate-limit-tracker";
import { registerShellHooks } from "./shell-hooks";
import { applyAnthropicCacheControl, type AnthropicCacheRequest } from "./prompt-cache";
import {
  type AgentImage,
  hasImages,
  toAnthropicImageBlock,
  toOpenAIImageBlock,
  toGoogleImagePart,
} from "./llm/image-blocks";
import {
  normalizeReasoningEffort,
  openAICompatReasoningParams,
  anthropicThinkingBudget,
  googleThinkingBudget,
} from "./llm/reasoning";
import { applyProviderApiKey } from "./llm/auth-headers";
import { normalizeLlmTimeoutError, withLlmRequestTimeout } from "./llm/request-timeout";
import {
  createStreamWatchdog,
  resolveLlmWatchdogDefaults,
  type StreamWatchdog,
} from "./llm/stream-watchdog";
import { consumeOpenAIChatStream } from "./llm/streaming-completions";
import { compactCodexInputItemsForContext, sanitizeCodexInputItems } from "./llm/codex-context";
import {
  compactToolTranscriptInPlace,
  isContextOverflowError,
  TOOL_RESULT_COMPACTION_NOTICE,
} from "./llm/tool-transcript";
import { trackTokenUsage } from "./llm/token-usage-tracking";
import {
  hasTextToolCallMarkup,
  normalizeAnthropicToolUses,
  normalizeOpenAIToolCalls,
  sanitizeAssistantContent,
  shouldUseMiniMaxReasoningSplit,
  toAnthropicReplayContentWithNormalizedToolUses,
  toOpenAIReplayMessageWithNormalizedToolCalls,
} from "./llm/text-tool-calls";
import { recallRelevantMemory } from "./memory/recall";
import { canRunToolsInParallel } from "./llm/parallel-tools";
import { coalesceSystemMessages } from "./llm/system-messages";
import {
  buildCompactedConversation,
  conversationNeedsCompaction,
  estimateConversationChars,
  planCompactionCut,
} from "./conversation-window";
import {
  anthropicEndpointPath,
  anthropicRequestBase,
  anthropicRequestHeaders,
} from "./llm/anthropic-vertex";
import {
  selectProvider,
  recordUsage,
  recordRateLimit as recordRouterRateLimit,
  isMixtureOfAgentsRoutingActive,
  getMixtureOfAgentsRoutingConfig,
} from "./router";
import {
  executeTool,
  formatMissingRequiredToolArgumentsError,
  getMissingRequiredToolArguments,
  hasTool,
} from "./tools/handlers/index";
import {
  buildSystemPrompt,
  AGENT_TYPE_PROMPTS,
  resolveModelAlias,
  getDefaultSystemPrompt,
} from "./system-prompt";
import { getSandboxPromptInfo } from "./sandbox";
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
  CONVERSATION_COMPACT_TRIGGER_RATIO,
  CONVERSATION_KEEP_RECENT_MESSAGES,
  CONVERSATION_MAX_MESSAGES,
  CONVERSATION_SUMMARY_MAX_CHARS,
  CONVERSATION_SUMMARY_PREFIX,
  DEFAULT_AGENTIC_MAX_ITERATIONS,
  DEFAULT_AGENTIC_MAX_RUNTIME_MS,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD,
  DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_TOOL_LOOP_WARNING_THRESHOLD,
  HARD_MAX_TOOL_RESULT_CHARS,
  LOOP_WARNING_BUCKET_SIZE,
  MAX_AGENTIC_CONFIGURED_ITERATIONS,
  MAX_AGENTIC_MAX_RUNTIME_MS,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  MIN_TOOL_RESULT_CHARS,
  OPENAI_CODEX_JWT_CLAIM_PATH,
  OPENAI_CODEX_OAUTH_MODEL_PREFIXES,
  appendToolErrorSummary,
  buildToolIterationFingerprint,
  extractSandboxProviderFromToolResult,
  formatToolActivityDetail,
  isObjectRecord,
  normalizeGoogleModelId,
  normalizePermissionList,
  parseAgentConfig,
  parseGoogleAuthHeaders,
  parseModelParams,
  parseServerSentEvents,
  parseToolArguments,
  readStringArg,
  summarizeProgressThought,
  toFiniteNumber,
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

registerCredentialsFromEnv("anthropic", "ANTHROPIC_API_KEY");
registerCredentialsFromEnv("openai", "OPENAI_API_KEY");
registerCredentialsFromEnv("google", "GEMINI_API_KEY");
registerCredentialsFromEnv("google", "GOOGLE_API_KEY");
registerCredentialsFromEnv("deepseek", "DEEPSEEK_API_KEY");
registerCredentialsFromEnv("xai", "XAI_API_KEY");

registerShellHooks();

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

/**
 * Decide how to interpret an agent's stored `tools` value. Pure and exported so
 * the security-sensitive "empty/corrupt restriction must not widen to ALL tools"
 * behavior is unit-testable. Returns:
 *  - `builtins`: no restriction configured → use the full builtin set.
 *  - `explicit`: an explicit list (INCLUDING an empty one) → use it verbatim.
 *  - `malformed`: a present-but-unparseable/non-array value → fail closed.
 */
export function resolveAgentToolSelection(
  rawTools: unknown
):
  | { kind: "builtins" }
  | { kind: "explicit"; tools: unknown[] }
  | { kind: "malformed"; reason: string } {
  if (rawTools === undefined || rawTools === null) return { kind: "builtins" };
  if (Array.isArray(rawTools)) return { kind: "explicit", tools: rawTools };
  if (typeof rawTools === "string") {
    let current: unknown = rawTools;
    for (let depth = 0; depth < 5; depth++) {
      if (Array.isArray(current)) return { kind: "explicit", tools: current };
      if (typeof current !== "string") break;
      const trimmed = current.trim();
      if (!trimmed) return { kind: "builtins" };
      try {
        current = JSON.parse(trimmed);
      } catch {
        return { kind: "malformed", reason: "unparseable" };
      }
    }
    if (Array.isArray(current)) return { kind: "explicit", tools: current };
    return { kind: "malformed", reason: "non-array" };
  }
  return { kind: "malformed", reason: "non-array" };
}

function shouldPreferMaxCompletionTokens(providerConfig?: string): boolean {
  const provider = (providerConfig || "").trim().toLowerCase();
  return provider === "z.ai" || provider === "zai" || provider === "z.ai-coding";
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
  /** Optional image inputs (vision). Only honored on user messages. */
  images?: AgentImage[];
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
  requiredToolName?: string;
  abortSignal?: AbortSignal;
  consumeSteeringMessages?: () => Array<{ id: string; content: string; createdAt: number }>;
}

interface RunningAgentState {
  agent: Agent;
  startedAt: Date;
  pid: number;
  messages: AgentMessage[];
  lastActive: Date;
}

class AgentManager {
  private runningAgents: Map<string, RunningAgentState> = new Map();

  /**
   * Pull the human-readable detail out of a raw LLM failure. Provider errors
   * arrive as `API error: <status> - <body>` where body is often OpenAI-style
   * JSON (`{"error":{"message":"..."}}`) or plain text. Returns a trimmed
   * single-line detail so the fallback can show the real cause instead of a
   * blank apology.
   */
  private extractLlmErrorDetail(message: string): string | undefined {
    const afterDash = message.replace(/^API error:\s*\d+\s*-\s*/i, "");
    const candidate = afterDash !== message ? afterDash : message;
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as {
          error?: { message?: unknown; code?: unknown } | string;
          message?: unknown;
          detail?: unknown;
        };
        const errObj = typeof parsed.error === "object" ? parsed.error : undefined;
        const detail =
          (errObj && typeof errObj.message === "string" && errObj.message) ||
          (typeof parsed.error === "string" && parsed.error) ||
          (typeof parsed.message === "string" && parsed.message) ||
          (typeof parsed.detail === "string" && parsed.detail) ||
          "";
        if (detail) return detail.replace(/\s+/g, " ").slice(0, 300);
      } catch {
        // Not JSON; fall through to the raw text.
      }
    }
    return trimmed.replace(/\s+/g, " ").slice(0, 300);
  }

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
    if (
      lower.includes("402") ||
      lower.includes("membership") ||
      lower.includes("payment required")
    ) {
      return "Provider billing/membership inactive (402). Check your provider account's subscription or credits.";
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

    const detail = this.extractLlmErrorDetail(message);
    if (lower.includes("400") || lower.includes("unsupported") || lower.includes("invalid")) {
      return detail
        ? `Provider rejected the request (400): ${detail}`
        : "Provider rejected the request (400). The model may not support a sent parameter.";
    }
    if (lower.includes("404")) {
      return detail
        ? `Provider endpoint/model not found (404): ${detail}`
        : "Provider endpoint or model not found (404). Verify the model id and base URL.";
    }
    if (lower.includes("5") && /\b5\d\d\b/.test(message)) {
      return detail
        ? `Provider server error: ${detail}`
        : "Provider had a server error (5xx). Retry shortly or switch providers.";
    }
    if (detail) {
      return `The provider request failed: ${detail}`;
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
    const routerSelected = selectProvider(agent.provider_id);
    if (routerSelected) {
      const routedProvider = providerManager.getWithCredentials(routerSelected);
      if (routedProvider) {
        if (persistIfResolved && agent.provider_id !== routerSelected) {
          this.update(agent.id, { provider_id: routerSelected });
          if ("provider_id" in agent) {
            agent.provider_id = routerSelected;
          }
        }
        return routedProvider;
      }
    }

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
        provider: a.provider_id,
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
      provider: agent.provider_id,
      typeConfig,
    };
  }

  create(definition: AgentDefinition): Agent {
    if (typeof definition?.name !== "string" || !definition.name.trim()) {
      throw new Error("Validation error: Agent name is required");
    }
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

    const configuredDefaultModel = config.get<string>("default_model");
    return this.create({
      name: "Mini",
      type: "research",
      model:
        (typeof configuredDefaultModel === "string" && configuredDefaultModel.trim()) ||
        providerInfo?.models?.[0]?.id ||
        "MiniMax-M2.5",
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
      sandboxInfo: getSandboxPromptInfo(homeDir),
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
      sandboxInfo: getSandboxPromptInfo(homeDir),
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

    // Mixture-of-agents routing: when the router runs the MoA strategy, fan the
    // turn out to several proposer agents and synthesize one answer. Guarded so
    // the proposer/aggregator sub-messages (which re-enter message()) run
    // normally instead of recursively re-triggering MoA.
    if (isMixtureOfAgentsRoutingActive()) {
      const moa = await import("./tools/handlers/mixture-of-agents");
      if (!moa.isMixtureOfAgentsActive()) {
        state.messages.push({ role: "user", content });
        const { maxAgents, aggregatorAgentId } = getMixtureOfAgentsRoutingConfig();
        const run = await moa.runMixtureOfAgents({ prompt: content, maxAgents, aggregatorAgentId });
        const response =
          (run.final || "").trim() ||
          run.error ||
          "Mixture of agents could not produce a response.";
        state.messages.push({ role: "assistant", content: response });
        return { response };
      }
    }

    state.messages.push({ role: "user", content });

    await this.maybeCompactConversation(state);

    const result = await this.executeWithState(state);

    state.messages.push({ role: "assistant", content: result.response });

    return result;
  }

  /**
   * Condense the oldest stored turns into a single summary message once the
   * conversation grows past its window, keeping recent turns verbatim. This
   * bounds the per-turn token cost of a long chat instead of letting the full
   * history replay every turn. Best-effort: any failure leaves history intact.
   */
  private async maybeCompactConversation(state: RunningAgentState): Promise<void> {
    try {
      const messages = state.messages;
      const systemCount = messages[0]?.role === "system" ? 1 : 0;
      const convo = messages.slice(systemCount);
      if (convo.length <= CONVERSATION_KEEP_RECENT_MESSAGES + 2) return;

      const provider = this.resolveProviderForAgent(state.agent, true);
      if (!provider) return;
      const resolved = this.resolveProviderModelForExecution(provider, state.agent.model);
      const activeProvider = resolved.provider;
      const activeModel = resolved.model;
      const providerConfig = String((activeProvider as { provider?: unknown }).provider || "");
      const providerId = (activeProvider as { id?: string }).id;
      const contextWindowTokens = this.resolveModelContextWindowTokens(
        providerConfig,
        providerId,
        activeModel || ""
      );
      const { contextBudgetChars } = this.resolveContextGuardBudgets(contextWindowTokens);
      const threshold = Math.floor(contextBudgetChars * CONVERSATION_COMPACT_TRIGGER_RATIO);
      const convoChars = estimateConversationChars(convo);
      if (
        !conversationNeedsCompaction({
          convoLength: convo.length,
          convoChars,
          threshold,
          maxMessages: CONVERSATION_MAX_MESSAGES,
          keepRecent: CONVERSATION_KEEP_RECENT_MESSAGES,
        })
      ) {
        return;
      }

      const cut = planCompactionCut(convo, CONVERSATION_KEEP_RECENT_MESSAGES);
      if (cut <= 0) return;

      const older = convo.slice(0, cut);
      const recent = convo.slice(cut);
      if (older.length === 0) return;

      const summaryText = await this.summarizeConversation(older, activeProvider, activeModel);
      if (!summaryText) return;

      const system = messages.slice(0, systemCount);
      state.messages = buildCompactedConversation(
        system,
        recent,
        summaryText,
        CONVERSATION_SUMMARY_PREFIX
      );
      console.log(
        `[Agent] Compacted conversation for "${state.agent.name}": ${older.length} turns -> summary, ${recent.length} kept`
      );
    } catch (error) {
      console.error("[Agent] Conversation compaction skipped:", error);
    }
  }

  private async summarizeConversation(
    older: AgentMessage[],
    provider: ReturnType<typeof providerManager.get>,
    model: string | undefined
  ): Promise<string | null> {
    const transcript = older
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => {
        const speaker = message.role === "user" ? "User" : "Assistant";
        const text = typeof message.content === "string" ? message.content : "";
        return `${speaker}: ${text}`;
      })
      .join("\n\n");
    if (!transcript.trim()) return null;

    const instruction =
      "You are compacting an ongoing conversation to preserve context within a limited window. " +
      "Summarize the exchange below into durable notes the assistant needs to keep helping: the " +
      "user's goals and constraints, decisions made, facts established, open questions, and any " +
      "task state. Preserve concrete identifiers (names, paths, values). Omit pleasantries. " +
      `Write terse bullet points, at most ${CONVERSATION_SUMMARY_MAX_CHARS} characters.`;

    try {
      const result = await this.callLLM(
        provider,
        model,
        [
          { role: "system", content: instruction },
          { role: "user", content: transcript },
        ],
        []
      );
      const summary = typeof result.content === "string" ? result.content.trim() : "";
      if (summary) {
        return summary.length > CONVERSATION_SUMMARY_MAX_CHARS
          ? summary.slice(0, CONVERSATION_SUMMARY_MAX_CHARS)
          : summary;
      }
    } catch (error) {
      console.error("[Agent] Conversation summary generation failed:", error);
    }

    // Heuristic fallback: keep the head and tail of the transcript so we still
    // shrink history even when the summary model is unavailable.
    return this.truncateTextWithHeadAndTail(transcript, CONVERSATION_SUMMARY_MAX_CHARS);
  }

  private async executeWithState(
    state: RunningAgentState
  ): Promise<{ response: string; thinking?: string }> {
    const { agent, messages } = state;

    const provider = this.resolveProviderForAgent(agent, true);
    if (!provider) {
      return { response: this.generateFallbackResponse(messages) };
    }

    const fullMessages = await this.injectMemoryRecall(messages, agent);

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
    return all.some((a) => a.type !== "subagent" && a.type !== "worker");
  }

  async autostartConfiguredAgents(): Promise<void> {
    for (const agent of this.list()) {
      if (agent.type === "subagent" || agent.type === "worker") continue;
      const cfg = parseAgentConfig(agent.config, agent.id);
      if (cfg.autostart === true && agent.status !== "running") {
        try {
          await this.start(agent.id);
          console.log(`[Agents] Auto-started "${agent.name}" on boot`);
        } catch (error) {
          console.error(`[Agents] Auto-start failed for "${agent.name}":`, error);
        }
      }
    }
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
    const workspaceAwareMessages = await this.injectMemoryRecall(
      this.injectWorkspaceSystemMessage(fullMessages, options?.workspaceDir),
      agent
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
      if (options?.abortSignal?.aborted) throw options.abortSignal.reason;
      return result;
    } catch (error) {
      if (options?.abortSignal?.aborted) throw error;
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
            if (options?.abortSignal?.aborted) throw options.abortSignal.reason;
            return fallbackResult;
          } catch (fallbackError) {
            if (options?.abortSignal?.aborted) throw fallbackError;
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

    const selection = resolveAgentToolSelection(agent.tools);
    if (selection.kind === "malformed") {
      // A malformed/corrupt restriction must NOT silently widen to every tool.
      console.warn(
        `[Agent] ${agent.id} has a ${selection.reason} tools config; restricting to no tools`
      );
      return [];
    }
    if (selection.kind === "explicit") {
      // An explicit list (including an empty one) is authoritative.
      return filterEnabledTools(selection.tools as ToolDefinition[]);
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
      requiredToolName:
        typeof options?.requiredToolName === "string" && options.requiredToolName.trim().length > 0
          ? options.requiredToolName.trim()
          : undefined,
      abortSignal: options?.abortSignal,
      consumeSteeringMessages: options?.consumeSteeringMessages,
    };
  }

  private async injectMemoryRecall(
    messages: AgentMessage[],
    agent: Agent
  ): Promise<AgentMessage[]> {
    if (!agent.memory_enabled) return messages;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const query = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
    if (!query) return messages;
    let recall = "";
    try {
      recall = await recallRelevantMemory(query);
    } catch {
      return messages;
    }
    if (!recall) return messages;
    const recallMessage = { role: "system" as const, content: recall };
    if (messages[0]?.role === "system") {
      return [messages[0], recallMessage, ...messages.slice(1)];
    }
    return [recallMessage, ...messages];
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
    const params = parseModelParams(parsedConfig.model_params ?? parsedConfig.modelParams);
    if (params.reasoning_effort === undefined && params.reasoningEffort === undefined) {
      const globalDefault = config.getDefaultReasoningEffort();
      if (globalDefault) params.reasoning_effort = globalDefault;
    }
    return params;
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
    // Fall back to a generous default cap instead of leaving the loop unbounded.
    const maxIterations = clampIterations(maxIterationsRaw ?? DEFAULT_AGENTIC_MAX_ITERATIONS);

    const maxRuntimeMsRaw =
      modelRuntimeMs ??
      (modelRuntimeSeconds ? modelRuntimeSeconds * 1000 : undefined) ??
      configRuntimeMs ??
      (configRuntimeSeconds ? configRuntimeSeconds * 1000 : undefined) ??
      envRuntimeMs ??
      (envRuntimeSeconds ? envRuntimeSeconds * 1000 : undefined);
    const maxRuntimeMs = clampRuntimeMs(maxRuntimeMsRaw ?? DEFAULT_AGENTIC_MAX_RUNTIME_MS);

    return {
      maxIterations,
      maxRuntimeMs,
      loopDetectionEnabled: loopDetectionEnabled ?? true,
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
      const errorMessage = this.normalizeErrorMessage(error);
      this.broadcastAgentStatus(
        "error",
        toolContext,
        formatToolActivityDetail(toolName, args, "error", errorMessage),
        {
          toolName,
          toolCallId,
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
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      toolNames: tools.map((tool) => tool.name),
    });

    const startedAt = performance.now();
    try {
      const result = await this.callLLMInternal(provider, model, messages, tools, toolContext);
      const sanitizedResult =
        typeof result.content === "string" && hasTextToolCallMarkup(result.content)
          ? { ...result, content: sanitizeAssistantContent(result.content) }
          : result;
      await emitAgentHook({
        type: "llm_response",
        context: hookContext,
        content: sanitizedResult.content,
        toolNames: (sanitizedResult.tool_calls || []).map((toolCall) => toolCall.name),
        durationMs: Math.round(performance.now() - startedAt),
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
    const baseUrl = providerInfo.base_url || this.getProviderBaseUrl(providerConfig);
    const auth = providerInfo.api_key || providerInfo.access_token;
    const providerDefinition = providerCatalog[providerConfig as ProviderType] as
      { api?: string; headers?: Record<string, string>; authType?: string } | undefined;
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
    const modelContextWindowTokens = this.resolveModelContextWindowTokens(
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
        modelContextWindowTokens
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

  private resolveModelContextWindowTokens(
    providerConfig: string,
    providerId: string | undefined,
    modelId: string
  ): number {
    const normalizePositiveInt = (value: unknown): number | undefined => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
      return Math.max(1, Math.floor(value));
    };

    const normalizedModelId = modelId.trim().toLowerCase();
    if (providerId) {
      const providerModels = providerManager.getModels(providerId) as Array<{
        model_id?: string | null;
        model_name?: string | null;
        context_window?: number | null;
      }>;
      const providerMatch = providerModels.find((entry) => {
        const candidateIds = [entry.model_id, entry.model_name].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        );
        return candidateIds.some((value) => value.trim().toLowerCase() === normalizedModelId);
      });
      const contextLimit = normalizePositiveInt(providerMatch?.context_window);
      if (contextLimit) return contextLimit;
    }

    const staticProvider = providerCatalog[providerConfig as ProviderType];
    const staticModel = staticProvider?.models?.find(
      (entry: { id?: string }) =>
        typeof entry.id === "string" && entry.id.trim().toLowerCase() === normalizedModelId
    ) as { context?: number } | undefined;
    const staticContextLimit = normalizePositiveInt(staticModel?.context);
    if (staticContextLimit) {
      return staticContextLimit;
    }

    return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
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

  private estimateOpenAIMessageChars(message: Record<string, unknown>): number {
    let total = 0;

    const content = message.content;
    if (typeof content === "string") {
      total += content.length;
    } else if (Array.isArray(content)) {
      try {
        const serialized = JSON.stringify(content);
        total += typeof serialized === "string" ? serialized.length : 0;
      } catch {
        total += 256;
      }
    }

    if (Array.isArray(message.tool_calls)) {
      try {
        const serialized = JSON.stringify(message.tool_calls);
        total += typeof serialized === "string" ? serialized.length : 0;
      } catch {
        total += 256;
      }
    }

    if (typeof message.tool_call_id === "string") {
      total += message.tool_call_id.length;
    }

    return total;
  }

  private estimateOpenAIContextChars(messages: Record<string, unknown>[]): number {
    return messages.reduce(
      (sum, message) => sum + this.estimateOpenAIMessageChars(message) + 64,
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

  /**
   * Truncate text keeping the HEAD and the TAIL with a truncation marker in the
   * middle. Preserves the beginning (setup/context) and the end (most-recent
   * output/errors) of long tool results (read/grep/exec), which a flat head-only
   * slice would discard. Falls back to head-only for very small budgets.
   */
  private truncateTextWithHeadAndTail(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    // Include the canonical truncation notice so callers/tests that detect it still match.
    const marker = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}\n[...${Math.max(1, text.length - maxChars)} chars truncated...]\n`;
    const budget = Math.max(0, maxChars - marker.length);
    if (budget <= 16) {
      return this.truncateTextToContextBudget(text, maxChars);
    }
    // Keep ~70% of the budget for the head (setup/context) and ~30% for the tail (recent output).
    const headBudget = Math.floor(budget * 0.7);
    const tailBudget = budget - headBudget;
    const head = text.slice(0, headBudget);
    const tail = text.slice(text.length - tailBudget);
    return head + marker + tail;
  }

  private truncateToolResultContentForContext(resultPayload: unknown, maxChars: number): string {
    let serialized = "";
    try {
      serialized = JSON.stringify(resultPayload);
    } catch {
      serialized = String(resultPayload);
    }
    // Tool results often have important context at both ends (file headers vs.
    // final output/errors), so preserve head + tail with a truncation marker.
    return this.truncateTextWithHeadAndTail(serialized, maxChars);
  }

  private compactAnthropicLoopMessagesForContext(
    messages: Record<string, unknown>[],
    contextBudgetChars: number,
    aggressive = false
  ): boolean {
    let totalChars = this.estimateAnthropicContextChars(messages);
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

      // Anthropic nests tool_result blocks inside a user message's content
      // array, so we elide at the block level — same shared notice and
      // elide-in-place philosophy as the flat Chat Completions / Responses
      // formats, just adapted to the nested shape.
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

    return compacted;
  }

  // Chat Completions wire format: tool results are `role:"tool"` messages.
  // Elides their content in place via the shared, provider-agnostic compactor
  // (same layer the OpenAI-Responses/"codex" and other paths use).
  private compactOpenAILoopMessagesForContext(
    messages: Record<string, unknown>[],
    contextBudgetChars: number,
    aggressive = false
  ): boolean {
    const elided = compactToolTranscriptInPlace(
      messages,
      contextBudgetChars,
      {
        isToolResult: (message) => message.role === "tool" && typeof message.content === "string",
        estimateChars: (message) => this.estimateOpenAIMessageChars(message) + 64,
        isElided: (message) => message.content === TOOL_RESULT_COMPACTION_NOTICE,
        elide: (message) => {
          message.content = TOOL_RESULT_COMPACTION_NOTICE;
        },
      },
      { aggressive }
    );
    return elided > 0;
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
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    // Streaming with inactivity watchdogs (first-token + stall, no total cap
    // by default): a healthy hours-long run keeps emitting chunks; only a
    // silent provider gets cut off. Providers that reject `stream` fall back
    // to a plain request guarded by a generous non-streaming ceiling.
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
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
          signal: watchdog.signal,
        });
        if (!response.ok) {
          watchdog.dispose();
          return response;
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        if (!contentType.includes("text/event-stream")) {
          // Provider ignored the stream flag and answered with plain JSON.
          const json = (await response.json()) as OpenAIResponse;
          watchdog.dispose();
          return json;
        }
        if (!response.body) {
          watchdog.dispose();
          throw new Error(`${errorPrefix}: empty streaming response body`);
        }
        watchdog.touch();
        const assembled = await consumeOpenAIChatStream(response.body, watchdog);
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

      if (
        contextRetryCount < 2 &&
        response.status === 400 &&
        isContextOverflowError(errorText)
      ) {
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
    const initialTokenLimit = this.resolveOpenAIRequestTokenLimit(
      requestBody,
      maxOutputTokens,
      contextWindowTokens
    );
    this.applyOpenAITokenLimit(requestBody, preferMaxCompletionTokens, initialTokenLimit);

    const openaiEffort = normalizeReasoningEffort(
      this.resolveModelParams(toolContext).reasoning_effort
    );
    if (openaiEffort) {
      Object.assign(requestBody, openAICompatReasoningParams(providerConfig || "", openaiEffort));
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

    const data = await this.postOpenAIChatCompletions(
      baseUrl,
      headers,
      requestBody,
      "API error",
      toolContext?.abortSignal
    );

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
        `[Agent] Agentic loop iteration ${iterations}: ${normalizedToolCalls.length} tool calls`
      );

      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];
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
              contextGuard.maxSingleToolResultChars
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
          iterationToolCalls.push({ name: toolName, args, result: resultPayload });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars
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
      const steeringText = this.consumeSteeringText(toolContext);
      if (steeringText) {
        currentMessages.push({ role: "user", content: steeringText });
      }
      this.compactOpenAILoopMessagesForContext(currentMessages, contextGuard.contextBudgetChars);

      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
      };
      const loopTokenLimit = this.resolveOpenAIRequestTokenLimit(
        loopRequestBody,
        maxOutputTokens,
        contextWindowTokens
      );
      this.applyOpenAITokenLimit(loopRequestBody, preferMaxCompletionTokens, loopTokenLimit);
      if (shouldUseMiniMaxReasoningSplit(providerConfig, modelId)) {
        loopRequestBody.reasoning_split = true;
      }

      if (tools && Array.isArray(tools) && tools.length > 0) {
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
      try {
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          loopRequestBody,
          "API error in agentic loop",
          toolContext?.abortSignal
        );
      } catch (error) {
        const errorMessage = this.normalizeErrorMessage(error);
        if (!isContextOverflowError(errorMessage)) {
          throw error;
        }
        const compacted = this.compactOpenAILoopMessagesForContext(
          currentMessages,
          Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
          true
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
          toolContext?.abortSignal
        );
      }
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        console.warn("[Agent] Agentic loop got an empty completion; stopping loop");
        break;
      }

      if (message.content) {
        finalContent = message.content;
      }
    }

    // A turn that executed tools must end with real assistant text: one
    // explicit no-tools nudge recovers the answer instead of surfacing a
    // synthetic "Completed N tool calls" placeholder to the user.
    if (!limitReason && !finalContent.trim() && allToolCalls.length > 0) {
      console.warn("[Agent] Final content empty after tool loop; requesting a closing response");
      try {
        currentMessages.push({
          role: "user",
          content:
            "Reply to the user now with your findings from the tool results above. Do not call any more tools.",
        });
        const nudgeBody: Record<string, unknown> = { model: modelId, messages: currentMessages };
        const limit = this.resolveOpenAIRequestTokenLimit(
          nudgeBody,
          maxOutputTokens,
          contextWindowTokens
        );
        this.applyOpenAITokenLimit(nudgeBody, preferMaxCompletionTokens, limit);
        const nudgeData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          nudgeBody,
          "API error in agentic loop closing response",
          toolContext?.abortSignal
        );
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

  private async parseOpenAICodexTurnResponse(
    response: Response,
    sessionId?: string,
    agentId?: string,
    watchdog?: StreamWatchdog
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
      watchdog?.touch();
      const type = typeof event.type === "string" ? event.type : "";

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
              /* streaming is best-effort */
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
    requestedModel: string,
    sessionId?: string,
    agentId?: string,
    signal?: AbortSignal
  ): Promise<OpenAICodexTurnResult & { resolvedModel: string }> {
    const candidates = this.getOpenAICodexModelCandidates(requestedModel);
    let finalError = "OpenAI Codex request failed";

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const body = { ...requestBody, model: candidate };
      // The watchdog covers the whole turn: connection, first event, and
      // every SSE chunk after it. Long runs stay alive as long as Codex
      // keeps emitting events; only silence trips it.
      const watchdog = createStreamWatchdog({
        ...resolveLlmWatchdogDefaults(url),
        callerSignal: signal,
        label: "Codex",
      });
      let response: Response;
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

      try {
        watchdog.touch();
        const parsed = await this.parseOpenAICodexTurnResponse(
          response,
          sessionId,
          agentId,
          watchdog
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
    contextWindowTokens?: number
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

      // Protocol guard: never send a function_call_output without its matching
      // function_call. The Codex Responses API 400s the whole request otherwise
      // ("No tool call found for function call output"). Logging the repair
      // count surfaces the root cause if one ever appears.
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
      const runCodexTurn = () =>
        this.postOpenAICodexTurn(
          codexUrl,
          headers,
          requestBody,
          activeModelId,
          // Suppress token streaming for meta calls (no sessionId => no broadcast).
          toolContext?.suppressStreaming ? undefined : toolContext?.sessionId,
          toolContext?.agentId,
          toolContext?.abortSignal
        );
      let turn: OpenAICodexTurnResult & { resolvedModel: string };
      try {
        turn = await runCodexTurn();
      } catch (error) {
        // Reactive compaction (OpenClaw's second trigger): honor the
        // provider's own overflow error by eliding hard and retrying once.
        if (!isContextOverflowError(this.normalizeErrorMessage(error))) throw error;
        compactCodexInputItemsForContext(
          inputItems,
          Math.max(4096, Math.floor(codexBudgetChars * 0.65)),
          true
        );
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
          // Cap a single tool output so one huge read/exec can't blow the
          // context window on a deep, hundreds-of-tool-call run.
          output: this.truncateToolResultContentForContext(resultPayload, codexMaxOutputChars),
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
      ? { "Content-Type": "application/json", Authorization: `Bearer ${auth.trim()}` }
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
        googleGenConfig.thinkingConfig = { thinkingBudget: googleThinkingBudget(googleEffort) };
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
        signal: withLlmRequestTimeout(toolContext?.abortSignal),
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
      requestBody.thinking = {
        type: "enabled",
        budget_tokens: anthropicThinkingBudget(anthropicEffort, maxOutputTokens),
      };
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

    // Prompt caching: mark the stable system prompt + recent turns as cacheable.
    // Anthropic honors up to 4 ephemeral breakpoints and reuses the cached prefix,
    // cutting input-token cost/latency substantially on multi-turn sessions.
    // No-op for requests too small to benefit; safe for all Anthropic models.
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

      // Capture rate-limit headers (per credential) for future scheduling decisions.
      if (activeCredential) recordRateLimit(activeCredential.label, response.headers);

      if (INITIAL_TRANSIENT_CODES.has(response.status) && attempt < INITIAL_MAX_RETRIES) {
        // On rate-limit / auth-like failures, try rotating to another credential first.
        if (response.status === 429 && activeCredential) {
          markCredentialCooldown(poolName, activeCredential, "rate_limit");
          // Also feed the model router's cooldown + circuit breaker.
          const retryAfter = parseInt(response.headers.get("retry-after") || "60", 10) * 1000;
          try {
            recordRouterRateLimit("anthropic", retryAfter || 60_000);
          } catch {
            /* best-effort */
          }
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
      trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs);
    }

    const loopPolicy = this.resolveAgenticLoopPolicy(toolContext);
    const contextWindowTokens = this.resolveModelContextWindowTokens(
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

      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
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
          const missingNamePayload = { error: "Tool use block missing tool name" };
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
              contextGuard.maxSingleToolResultChars
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
          iterationToolCalls.push({ name: toolName, args, result: resultPayload });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars
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
            contextGuard.maxSingleToolResultChars
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
        content: steeringText
          ? [...toolResults, { type: "text", text: steeringText }]
          : toolResults,
      });

      this.compactAnthropicLoopMessagesForContext(currentMessages, contextGuard.contextBudgetChars);

      const loopRequestBody: Record<string, unknown> = anthropicRequestBase(
        modelId,
        currentMessages,
        maxOutputTokens,
        vertex
      );

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

      // Re-anchor the cache each iteration so the stable prefix (system + prior
      // turns) stays cached and only the newest tool results are re-billed;
      // otherwise every loop iteration pays full price for the whole prefix.
      const loopCached = applyAnthropicCacheControl(
        {
          system: loopRequestBody.system as string | undefined,
          messages: loopRequestBody.messages as AnthropicCacheRequest["messages"],
        },
        { strategy: "system_and_3", ttl: "1h" }
      );
      if (loopCached.system !== undefined) loopRequestBody.system = loopCached.system;
      loopRequestBody.messages = loopCached.messages;

      const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 520, 529]);
      const MAX_RETRIES = 3;
      let loopResponse: Response | null = null;
      let lastLoopError = "";
      let loopFatalError = false;

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

          // Context window exceeded — compact and retry immediately
          if (loopResponse.status === 400 && isContextOverflowError(lastLoopError)) {
            this.compactAnthropicLoopMessagesForContext(
              currentMessages,
              Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
              true
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
              break;
            }
            loopResponse = retryResponse;
            break;
          }

          // Transient server error — retry with exponential backoff
          if (TRANSIENT_STATUS_CODES.has(loopResponse.status) && attempt < MAX_RETRIES) {
            const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
            console.warn(
              `[Agent] Anthropic transient error ${loopResponse.status} on iteration ${iterations}, ` +
                `retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // Exhausted retries or non-retryable error
          loopFatalError = true;
          break;
        }
      } catch (fetchError) {
        // Network-level error (DNS, timeout, etc.)
        console.error(`[Agent] Anthropic fetch error on iteration ${iterations}:`, fetchError);
        loopFatalError = true;
        lastLoopError = String(fetchError);
      }

      // If the API call failed after retries, gracefully stop the loop
      // and return whatever content we've accumulated so far
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

      // Parse successful response
      const responseData = (await loopResponse.json()) as AnthropicResponse;
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
    const maxOutputTokens = this.resolveModelMaxOutputTokens("openai", undefined, modelId);
    const contextWindowTokens = this.resolveModelContextWindowTokens("openai", undefined, modelId);
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
      toolContext?.abortSignal
    );

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

      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];
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
              contextGuard.maxSingleToolResultChars
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
          iterationToolCalls.push({ name: toolName, args, result: resultPayload });
        }
        if (!executed.skipped && executed.result !== undefined) {
          allToolCalls.push({ name: toolName, args, result: executed.result });
        }
        toolResults.push({
          tool_call_id: toolCallId,
          role: "tool",
          content: this.truncateToolResultContentForContext(
            resultPayload,
            contextGuard.maxSingleToolResultChars
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
      const steeringText = this.consumeSteeringText(toolContext);
      if (steeringText) {
        currentMessages.push({ role: "user", content: steeringText });
      }
      this.compactOpenAILoopMessagesForContext(currentMessages, contextGuard.contextBudgetChars);

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
        loopRequestBody.tool_choice = "auto";
      }

      let loopData: OpenAIResponse;
      try {
        loopData = await this.postOpenAIChatCompletions(
          baseUrl,
          headers,
          loopRequestBody,
          "API error in agentic loop",
          toolContext?.abortSignal
        );
      } catch (error) {
        const errorMessage = this.normalizeErrorMessage(error);
        if (!isContextOverflowError(errorMessage)) {
          throw error;
        }
        const compacted = this.compactOpenAILoopMessagesForContext(
          currentMessages,
          Math.max(4096, Math.floor(contextGuard.contextBudgetChars * 0.65)),
          true
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
          toolContext?.abortSignal
        );
      }
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
