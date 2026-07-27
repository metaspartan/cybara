import { tables, type Agent, type ToolDefinition } from "./database";
import { AgentProviderRuntime } from "./agent-provider-runtime";
import { truncateTextWithHeadAndTail } from "./agent-context-guard";
import { config } from "./config";
import {
  providerManager,
  getDefaultModel,
  providers as providerCatalog,
  type ProviderType,
} from "./providers";
import { getToolSchemasForLLM, type ToolContext } from "./tools/index";
import { registerCredentialsFromEnv } from "./credential-pool";
import { registerShellHooks } from "./shell-hooks";
import type { AgentImage } from "./llm/image-blocks";
import { recallRelevantMemory } from "./memory/recall";
import {
  buildCompactedConversation,
  conversationNeedsCompaction,
  resolveCompactionTriggerRatio,
  resolveKeepRecentMessages,
  resolveMaxConversationMessages,
  estimateConversationChars,
  planCompactionCut,
} from "./conversation-window";
import {
  getRouterRouteModel,
  selectProvider,
  selectProviderWithLiveUsage,
  isModelRouterEnabled,
  isMixtureOfAgentsRoutingActive,
  getMixtureOfAgentsRoutingConfig,
} from "./router";
import {
  buildSystemPrompt,
  AGENT_TYPE_PROMPTS,
  resolveModelAlias,
  getDefaultSystemPrompt,
} from "./system-prompt";
import { getBootstrapContextFiles } from "./bootstrap-files";
import { getSandboxPromptInfo } from "./sandbox";
import {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  CONVERSATION_KEEP_RECENT_MESSAGES,
  CONVERSATION_SUMMARY_MAX_CHARS,
  CONVERSATION_SUMMARY_PREFIX,
  OPENAI_CODEX_OAUTH_MODEL_PREFIXES,
  normalizePermissionList,
  parseAgentConfig,
  type AgentToolCallResult,
} from "./agent-internals";
import { loadAllSkills, createEligibilityContext, filterEligibleSkills } from "./skills";
import { resolveAgentToolPolicy } from "./toolsets";
import { formatLlmFailure } from "./agent-error-format";
import { resolveModelContextWindowTokens } from "./agent-model-limits";
import {
  classifyApiError,
  type ApiErrorCategory,
  type ClassifiedApiError,
} from "./error-classifier";
import {
  getProviderAccountPool,
  markProviderAccountHealthy,
  markProviderAccountUnavailable,
  parseProviderAccountPoolRouteId,
  type ProviderAccountFailure,
} from "./provider-account-pool";

export { resolveAgentToolSelection } from "./agent-tool-selection";

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
  provider_pool_id?: string;
  fallback_provider_id?: string;
  fallback_provider?: string;
  system_prompt?: string;
  tools?: ToolDefinition[];
  memory_enabled?: boolean;
  config?: Record<string, unknown>;
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
  consumeSteeringMessages?: () => Array<{
    id: string;
    content: string;
    createdAt: number;
  }>;
  useModelRouter?: boolean;
  allowedToolNames?: string[];
}

interface RunningAgentState {
  agent: Agent;
  startedAt: Date;
  pid: number;
  messages: AgentMessage[];
  lastActive: Date;
}

type ResolvedProvider = NonNullable<ReturnType<typeof providerManager.getWithCredentials>>;

interface ProviderExecutionTarget {
  provider: ResolvedProvider;
  poolId?: string;
  routeId?: string;
}

export interface AgentExecutionResult {
  content: string;
  thinking?: string;
  tool_calls?: AgentToolCallResult[];
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  router_route_id?: string;
  failure?: AgentExecutionFailure;
}

export interface AgentExecutionFailure {
  category: ApiErrorCategory;
  retryable: boolean;
}

class AgentManager extends AgentProviderRuntime {
  private runningAgents: Map<string, RunningAgentState> = new Map();

  private formatProviderFailure(error: unknown, provider: ResolvedProvider): string {
    const catalogEntry = providerCatalog[provider.provider as ProviderType];
    return formatLlmFailure(error, {
      authType: catalogEntry?.authType,
      providerName: provider.name || catalogEntry?.name,
    });
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

  private resolveModelForRoutedProvider(
    provider: NonNullable<ReturnType<typeof providerManager.getWithCredentials>>,
    agentModel: string | undefined
  ): string {
    if (!agentModel || !agentModel.trim()) return getDefaultModel(provider.provider);
    const models = providerManager.getModels(provider.id);
    if (models.length === 0) return agentModel;
    const target = agentModel.trim().toLowerCase();
    const supported = models.some((model) => model.model_id.trim().toLowerCase() === target);
    return supported ? agentModel : getDefaultModel(provider.provider);
  }

  private providerAccountFailure(error: ClassifiedApiError): ProviderAccountFailure | undefined {
    if (error.category === "auth") return "auth";
    if (error.category === "billing") return "billing";
    if (error.category === "rate_limit") return "rate_limit";
    return undefined;
  }

  private async callLLMWithAccountPool(
    primary: ResolvedProvider,
    poolId: string | undefined,
    model: string | undefined,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolContext?: ToolContext
  ): Promise<AgentExecutionResult> {
    const candidates = await providerManager.getAccountPoolCandidates(primary.id, poolId);
    if (candidates.length === 0) {
      throw new Error(`All ${primary.provider} accounts are cooling down or unavailable.`);
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      const toolCallsBefore = toolContext?.executionState?.toolCallsStarted ?? 0;
      try {
        const result = await this.callLLM(candidate, model, messages, tools, toolContext);
        markProviderAccountHealthy(candidate.id);
        return {
          ...result,
          provider: candidate.provider,
          provider_id: candidate.id,
          provider_name: candidate.name,
          model,
          router_route_id: toolContext?.routerRouteId,
        };
      } catch (error) {
        lastError = error;
        let classified = classifyApiError({ error });
        let failure = this.providerAccountFailure(classified);
        if (!failure || (toolContext?.executionState?.toolCallsStarted ?? 0) > toolCallsBefore) {
          throw error;
        }

        if (failure === "auth" && candidate.refresh_token) {
          const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(candidate, {
            force: true,
          });
          if (refreshed) {
            try {
              const result = await this.callLLM(refreshed, model, messages, tools, toolContext);
              markProviderAccountHealthy(candidate.id);
              return {
                ...result,
                provider: refreshed.provider,
                provider_id: refreshed.id,
                provider_name: refreshed.name,
                model,
                router_route_id: toolContext?.routerRouteId,
              };
            } catch (refreshError) {
              lastError = refreshError;
              classified = classifyApiError({ error: refreshError });
              failure = this.providerAccountFailure(classified);
              if (
                !failure ||
                (toolContext?.executionState?.toolCallsStarted ?? 0) > toolCallsBefore
              ) {
                throw refreshError;
              }
            }
          }
        }

        markProviderAccountUnavailable(candidate.id, failure);
      }
    }

    throw lastError ?? new Error(`All ${primary.provider} accounts are unavailable.`);
  }

  private failedExecutionResult(
    error: unknown,
    toolContext: ToolContext,
    provider: ResolvedProvider,
    model: string | undefined
  ): AgentExecutionResult {
    const classified = classifyApiError({ error });
    const toolCalls = [...(toolContext.executionState?.toolCalls || [])]
      .sort((left, right) => left.order - right.order)
      .map(({ name, args, result, durationMs }) => ({ name, args, result, duration: durationMs }));
    return {
      content: classified.retryable ? "" : this.formatProviderFailure(error, provider),
      tool_calls: toolCalls.length > 0 ? [...toolCalls] : undefined,
      provider: provider.provider,
      provider_id: provider.id,
      provider_name: provider.name,
      model,
      router_route_id: toolContext.routerRouteId,
      failure: {
        category: classified.category,
        retryable: classified.retryable,
      },
    };
  }

  private agentProviderPoolId(agent: Pick<Agent, "config">): string | undefined {
    const value = parseAgentConfig(agent.config).provider_account_pool_id;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private resolveProviderExecutionTarget(
    agent: Pick<Agent, "id" | "provider_id" | "config">,
    options: { useRouter: boolean; persistIfResolved: boolean }
  ): ProviderExecutionTarget | undefined {
    const poolId = this.agentProviderPoolId(agent);
    if (poolId) {
      const provider = providerManager.getAccountPoolPrimary(poolId);
      if (provider) return { provider, poolId };
    }

    if (options.useRouter && isModelRouterEnabled()) {
      const routeId = selectProvider(agent.provider_id);
      const routed = routeId ? providerManager.resolveExecutionTarget(routeId) : undefined;
      if (routed && routeId) return { ...routed, routeId };
    }

    let resolvedProvider =
      typeof agent.provider_id === "string" && agent.provider_id.trim()
        ? providerManager.getWithCredentials(agent.provider_id)
        : undefined;

    if (resolvedProvider) return { provider: resolvedProvider };

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

    if (options.persistIfResolved && agent.provider_id !== resolvedProviderId) {
      this.update(agent.id, { provider_id: resolvedProviderId });
      if ("provider_id" in agent) {
        agent.provider_id = resolvedProviderId;
      }
    }

    return { provider: resolvedProvider };
  }

  private async resolveProviderExecutionTargetWithLiveUsage(
    agent: Pick<Agent, "id" | "provider_id" | "config">
  ): Promise<ProviderExecutionTarget | undefined> {
    const poolId = this.agentProviderPoolId(agent);
    if (poolId) {
      const provider = providerManager.getAccountPoolPrimary(poolId);
      if (provider) return { provider, poolId };
    }
    if (isModelRouterEnabled()) {
      const routeId = await selectProviderWithLiveUsage(agent.provider_id);
      const routed = routeId ? providerManager.resolveExecutionTarget(routeId) : undefined;
      if (routed && routeId) return { ...routed, routeId };
    }
    return this.resolveProviderExecutionTarget(agent, {
      useRouter: false,
      persistIfResolved: false,
    });
  }

  private resolveProviderForAgent(
    agent: Pick<Agent, "id" | "provider_id" | "config">,
    persistIfResolved = false
  ): ReturnType<typeof providerManager.getWithCredentials> {
    return this.resolveProviderExecutionTarget(agent, {
      useRouter: true,
      persistIfResolved,
    })?.provider;
  }

  resolveProvider(id: string): ReturnType<typeof providerManager.getWithCredentials> {
    const agent = this.get(id);
    if (!agent) return undefined;
    return this.resolveProviderExecutionTarget(agent, {
      useRouter: false,
      persistIfResolved: true,
    })?.provider;
  }

  list(): (Agent & {
    provider?: string;
    provider_type?: string;
    provider_pool_id?: string;
    provider_pool_name?: string;
    providerInfo?: { name: string };
    typeConfig?: typeof AGENT_TYPES.main;
  })[] {
    const all = tables.agents.all() as Agent[];
    const providersById = new Map(
      providerManager.list().map((provider) => [provider.id, provider])
    );
    return all.map((a) => {
      const provider = a.provider_id ? providersById.get(a.provider_id) : undefined;
      const providerPoolId = this.agentProviderPoolId(a);
      const providerPool = providerPoolId ? getProviderAccountPool(providerPoolId) : undefined;
      const typeConfig = a.type ? AGENT_TYPES[a.type as keyof typeof AGENT_TYPES] : undefined;
      const status = this.runningAgents.has(a.id) ? "running" : "stopped";
      return {
        ...a,
        status,
        provider: a.provider_id,
        provider_type: provider?.provider,
        provider_pool_id: providerPoolId,
        provider_pool_name: providerPool?.name,
        providerInfo: provider ? { name: provider.name } : undefined,
        typeConfig,
      };
    });
  }

  get(id: string):
    | (Agent & {
        provider?: string;
        provider_type?: string;
        provider_pool_id?: string;
        provider_pool_name?: string;
        typeConfig?: typeof AGENT_TYPES.main;
      })
    | undefined {
    const agent = tables.agents.get(id) as Agent | undefined;
    if (!agent) return undefined;
    const typeConfig = agent.type ? AGENT_TYPES[agent.type as keyof typeof AGENT_TYPES] : undefined;
    const status = this.runningAgents.has(agent.id) ? "running" : "stopped";
    const providerPoolId = this.agentProviderPoolId(agent);
    const providerPool = providerPoolId ? getProviderAccountPool(providerPoolId) : undefined;
    return {
      ...agent,
      status,
      provider: agent.provider_id,
      provider_type: agent.provider_id
        ? providerManager.get(agent.provider_id)?.provider
        : undefined,
      provider_pool_id: providerPoolId,
      provider_pool_name: providerPool?.name,
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

    const agentConfig = { ...(definition.config || {}) };
    const requestedPoolId =
      typeof definition.provider_pool_id === "string" ? definition.provider_pool_id.trim() : "";
    const requestedPool = requestedPoolId ? getProviderAccountPool(requestedPoolId) : undefined;
    if (requestedPoolId && (!requestedPool?.enabled || requestedPool.accounts.length === 0)) {
      throw new Error("Validation error: Provider account pool is unavailable");
    }
    if (requestedPool) agentConfig.provider_account_pool_id = requestedPool.id;
    const poolProviderId = requestedPool?.accounts[0]?.providerId;
    const resolvedProviderId =
      providerManager.resolveProviderId(poolProviderId) ||
      providerManager.resolveProviderId(definition.provider_id || definition.provider) ||
      poolProviderId ||
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
      config: agentConfig,
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
    const homeDir = config.getDefaultWorkspaceDir();

    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: undefined,
      config: {},
      modelDisplay: definition.model || typeConfig?.defaultModel || "MiniMax-M2.5",
      tools: (definition.tools ?? getBuiltinTools()).map((t) => t.name),
      executionMode: definition.type === "planner" ? "plan" : "execute",
      skills: eligibleSkills,
      contextFiles: getBootstrapContextFiles(homeDir),
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

    const existingConfig = parseAgentConfig(existing.config, id);
    const updatedConfig = updates.config ? { ...updates.config } : { ...existingConfig };
    const poolSelectionChanged = updates.provider_pool_id !== undefined;
    const requestedPoolId =
      typeof updates.provider_pool_id === "string" ? updates.provider_pool_id.trim() : "";
    const requestedPool = requestedPoolId ? getProviderAccountPool(requestedPoolId) : undefined;
    if (
      poolSelectionChanged &&
      requestedPoolId &&
      (!requestedPool?.enabled || requestedPool.accounts.length === 0)
    ) {
      throw new Error("Validation error: Provider account pool is unavailable");
    }
    if (poolSelectionChanged) {
      if (requestedPool) updatedConfig.provider_account_pool_id = requestedPool.id;
      else delete updatedConfig.provider_account_pool_id;
    }
    const poolProviderId = requestedPool?.accounts[0]?.providerId;
    const providerSelectionChanged =
      updates.provider_id !== undefined || updates.provider !== undefined;
    if (providerSelectionChanged && !poolSelectionChanged) {
      delete updatedConfig.provider_account_pool_id;
    }
    const resolvedProviderId =
      poolProviderId ||
      (providerSelectionChanged
        ? providerManager.resolveProviderId(
            (updates.provider_id as string | undefined) || (updates.provider as string | undefined)
          )
        : undefined);
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
        providerSelectionChanged || poolSelectionChanged
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
      config: updatedConfig,
    };

    tables.agents.update(id, updated);
    return { ...existing, ...updated } as Agent;
  }

  async start(id: string): Promise<boolean> {
    const agent = this.get(id);
    if (!agent) return false;

    const homeDir = config.getDefaultWorkspaceDir();

    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: {
        name: agent.name,
        config: agent.config as string | undefined,
      },
      config: {},
      modelDisplay: agent.model || "MiniMax-M2.5",
      tools: this.getAgentTools(agent).map((t) => t.name),
      executionMode: agent.type === "planner" ? "plan" : "execute",
      skills: eligibleSkills,
      contextFiles: getBootstrapContextFiles(homeDir),
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

    if (isMixtureOfAgentsRoutingActive()) {
      const moa = await import("./tools/handlers/mixture-of-agents");
      if (!moa.isMixtureOfAgentsActive()) {
        state.messages.push({ role: "user", content });
        const { maxAgents, aggregatorAgentId } = getMixtureOfAgentsRoutingConfig();
        const run = await moa.runMixtureOfAgents({
          prompt: content,
          maxAgents,
          aggregatorAgentId,
        });
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
      const contextWindowTokens = resolveModelContextWindowTokens(
        providerConfig,
        providerId,
        activeModel || ""
      );
      const compactTokens = Math.max(1024, Math.floor(contextWindowTokens));
      const compactRatio = resolveCompactionTriggerRatio(
        compactTokens,
        Number(config.get<number>("compaction_trigger_ratio"))
      );
      const threshold = Math.floor(compactTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * compactRatio);
      const maxMessages = resolveMaxConversationMessages(compactTokens);
      const keepRecent = resolveKeepRecentMessages(compactTokens);
      const convoChars = estimateConversationChars(convo);
      if (
        !conversationNeedsCompaction({
          convoLength: convo.length,
          convoChars,
          threshold,
          maxMessages,
          keepRecent,
        })
      ) {
        return;
      }

      const cut = planCompactionCut(convo, keepRecent);
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

    return truncateTextWithHeadAndTail(transcript, CONVERSATION_SUMMARY_MAX_CHARS);
  }

  private async executeWithState(
    state: RunningAgentState
  ): Promise<{ response: string; thinking?: string }> {
    const { agent, messages } = state;

    const target = await this.resolveProviderExecutionTargetWithLiveUsage(agent);
    if (!target) {
      return { response: this.generateFallbackResponse(messages) };
    }
    const provider = target.provider;

    const fullMessages = await this.injectMemoryRecall(messages, agent);

    const supportsTools = true;

    let tools: ToolDefinition[] = [];
    if (supportsTools) {
      tools = this.getAgentTools(agent);
    }
    const toolContext = this.buildToolExecutionContext(agent);
    toolContext.routerRouteId = target.routeId;

    const routedModel = target.routeId ? getRouterRouteModel(target.routeId) : undefined;
    const selectedModel =
      routedModel ||
      (target.routeId && provider.id !== agent.provider_id
        ? this.resolveModelForRoutedProvider(provider, agent.model)
        : agent.model);
    const resolvedExecution = this.resolveProviderModelForExecution(provider, selectedModel);
    const activeProvider = resolvedExecution.provider;
    const activeModel = resolvedExecution.model;
    const activePoolId = activeProvider.provider === provider.provider ? target.poolId : undefined;
    const toolCallsBeforePrimary = toolContext.executionState?.toolCalls.length ?? 0;

    try {
      const result = await this.callLLMWithAccountPool(
        activeProvider,
        activePoolId,
        activeModel,
        fullMessages,
        tools,
        toolContext
      );
      return { response: result.content, thinking: result.thinking };
    } catch (error) {
      console.error("[Agent] LLM call failed:", error);

      const primaryExecutedTools =
        (toolContext.executionState?.toolCalls.length ?? 0) > toolCallsBeforePrimary;
      if (
        !primaryExecutedTools &&
        agent.fallback_provider_id &&
        activeProvider.id !== agent.fallback_provider_id
      ) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLMWithAccountPool(
              fallbackProvider,
              undefined,
              activeModel,
              fullMessages,
              tools,
              { ...toolContext, routerRouteId: undefined }
            );
            return {
              response: fallbackResult.content,
              thinking: fallbackResult.thinking,
            };
          } catch (fallbackError) {
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
            return { response: this.formatProviderFailure(fallbackError, fallbackProvider) };
          }
        }
      }

      return { response: this.formatProviderFailure(error, activeProvider) };
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
  ): Promise<AgentExecutionResult> {
    const agent = this.get(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const target =
      options?.useModelRouter === true
        ? await this.resolveProviderExecutionTargetWithLiveUsage(agent)
        : this.resolveProviderExecutionTarget(agent, {
            useRouter: false,
            persistIfResolved: true,
          });
    if (!target) {
      return { content: this.generateFallbackResponse(messages) };
    }
    let provider = target.provider;

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
        tools = this.getAgentTools(agent, options?.allowedToolNames);
      } else if (agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          provider = fallbackProvider;
          tools = this.getAgentTools(agent, options?.allowedToolNames);
        }
      }
    }

    const toolContext = this.buildToolExecutionContext(agent, options);
    toolContext.routerRouteId = target.routeId;

    const routerActive = options?.useModelRouter === true && !!provider;
    const routedToDifferentProvider = routerActive && provider!.id !== agent.provider_id;
    const routedModel =
      routerActive && target.routeId ? getRouterRouteModel(target.routeId) : undefined;
    const overrideModel =
      typeof options?.modelOverride === "string" && options.modelOverride.trim().length > 0
        ? options.modelOverride.trim()
        : undefined;
    const selectedModel =
      routedModel ||
      overrideModel ||
      (routedToDifferentProvider
        ? this.resolveModelForRoutedProvider(provider!, agent.model)
        : agent.model);

    const resolvedExecution = this.resolveProviderModelForExecution(provider, selectedModel);
    const activeProvider = resolvedExecution.provider;
    const activeModel = resolvedExecution.model;
    const activePoolId = activeProvider.provider === provider.provider ? target.poolId : undefined;
    const toolCallsBeforePrimary = toolContext.executionState?.toolCalls.length ?? 0;

    try {
      const result = await this.callLLMWithAccountPool(
        activeProvider,
        activePoolId,
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

      const primaryExecutedTools =
        (toolContext.executionState?.toolCalls.length ?? 0) > toolCallsBeforePrimary;
      if (
        !primaryExecutedTools &&
        agent.fallback_provider_id &&
        activeProvider.id !== agent.fallback_provider_id
      ) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLMWithAccountPool(
              fallbackProvider,
              undefined,
              activeModel,
              workspaceAwareMessages,
              tools,
              { ...toolContext, routerRouteId: undefined }
            );
            if (options?.abortSignal?.aborted) throw options.abortSignal.reason;
            return fallbackResult;
          } catch (fallbackError) {
            if (options?.abortSignal?.aborted) throw fallbackError;
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
            return this.failedExecutionResult(
              fallbackError,
              toolContext,
              fallbackProvider,
              activeModel
            );
          }
        }
      }

      return this.failedExecutionResult(error, toolContext, activeProvider, activeModel);
    }
  }

  private getAgentTools(agent: Agent, inheritedAllowedToolNames?: string[]): ToolDefinition[] {
    const policy = resolveAgentToolPolicy(agent, inheritedAllowedToolNames);
    if (!policy.valid) {
      console.warn(`[Agent] ${agent.id} has ${policy.reason}; restricting to no tools`);
    }
    return policy.offeredTools;
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
    const toolPolicy = resolveAgentToolPolicy(agent, options?.allowedToolNames);
    const workspaceDir = options?.workspaceDir?.trim() || config.getDefaultWorkspaceDir();
    return {
      agentId: agent.id,
      sessionId: options?.sessionId,
      workspaceDir,
      channel: options?.channel,
      userId: options?.userId,
      permissions: permissions.permissions,
      enforcePermissions: permissions.enforcePermissions,
      requireToolUse: options?.requireToolUse === true,
      requiredToolName:
        typeof options?.requiredToolName === "string" && options.requiredToolName.trim().length > 0
          ? options.requiredToolName.trim()
          : undefined,
      allowedToolNames: toolPolicy.allowedToolNames,
      allowDynamicTools: toolPolicy.allowDynamicTools,
      abortSignal: options?.abortSignal,
      confineToWorkspace: true,
      consumeSteeringMessages: options?.consumeSteeringMessages,
      executionState: { nextToolCallOrder: 0, toolCallsStarted: 0, toolCalls: [] },
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
