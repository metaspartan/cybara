import { tables, type Agent, type ToolDefinition } from "./database";
import { providerManager, getProviderBaseUrl, getDefaultModel } from "./providers";
import { getToolSchemasForLLM, toolSchemas } from "./tools/index";
import { executeTool, hasTool } from "./tools/handlers/index";
import { buildSystemPrompt, AGENT_TYPE_PROMPTS, resolveModelAlias, getDefaultSystemPrompt } from "./system-prompt";
import { broadcastStatus } from "./status";
import { homedir } from "os";
import { loadAllSkills, createEligibilityContext, filterEligibleSkills } from "./skills";

export interface AgentDefinition {
  name: string;
  type?: "main" | "research" | "coder" | "planner" | "ops" | "subagent" | "worker";
  model?: string;
  provider_id?: string;
  fallback_provider_id?: string;
  system_prompt?: string;
  tools?: ToolDefinition[];
  memory_enabled?: boolean;
  config?: Record<string, unknown>;
}

// LLM API Response Interfaces
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

// Token tracking helper - now includes duration for TPS calculation
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

    // Track by model
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_model",
      key: model,
      value: totalTokens,
    });

    // Track by provider with URL
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_provider",
      key: provider,
      value: totalTokens,
      metadata: JSON.stringify({ url: providerUrl }),
    });

    // Track totals
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "input",
      value: inputTokens,
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "output",
      value: outputTokens,
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "all",
      value: totalTokens,
    });

    // Track API call with URL
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

    // Track agent activity with timestamp
    tables.metrics.add({ id: crypto.randomUUID(), type: "agent_execution", key: "all", value: 1 });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "agent_execution",
      key: "message",
      value: 1,
      metadata: JSON.stringify({ timestamp: Date.now() }),
    });

    // Track last activity timestamp separately
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "system_status",
      key: "last_activity",
      value: Date.now(),
    });

    // Track tokens per second (TPS) if duration is provided
    if (durationMs && durationMs > 0) {
      const tps = Math.round((outputTokens / durationMs) * 1000); // output tokens per second

      // Track TPS by model
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_tps",
        key: model,
        value: tps,
        metadata: JSON.stringify({
          provider,
          inputTokens,
          outputTokens,
          durationMs,
          timestamp: Date.now()
        }),
      });

      // Track duration by model
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_latency",
        key: model,
        value: durationMs,
        metadata: JSON.stringify({ provider }),
      });

      console.log(
        `[Metrics] TPS: ${tps} tok/s (${outputTokens} tokens in ${durationMs}ms) for ${model}`
      );
    }

    // Broadcast status via event system
    broadcastStatus({ status: "thinking", timestamp: Date.now() });

    console.log(
      `[Metrics] Tracked tokens: input=${inputTokens}, output=${outputTokens}, model=${model}, provider=${provider}`
    );
  } catch (e) {
    console.error("[Metrics] Token tracking failed:", e);
  }
}


// Built-in tools - get from the tools registry
export const builtinTools: ToolDefinition[] = Object.values(toolSchemas).map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

// Agent type configuration - matches Clawdbot's patterns
export const AGENT_TYPES = {
  main: {
    description: "General-purpose assistant",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.main,
  },
  research: {
    description: "Research and information gathering",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.research,
  },
  coder: {
    description: "Coding and software development",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.coder,
  },
  planner: {
    description: "Planning and task breakdown",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.planner,
  },
  ops: {
    description: "Operations and system administration",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.ops,
  },
  subagent: {
    description: "Subagent for delegated tasks",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
    systemPrompt: AGENT_TYPE_PROMPTS.main,
  },
  worker: {
    description: "Worker for background tasks",
    defaultModel: "MiniMax-M2.1",
    tools: builtinTools,
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

// Running agent state with conversation memory
interface RunningAgentState {
  agent: Agent;
  startedAt: Date;
  pid: number;
  messages: AgentMessage[];
  lastActive: Date;
}

class AgentManager {
  private runningAgents: Map<string, RunningAgentState> = new Map();

  list(): (Agent & { provider?: { name: string }; typeConfig?: typeof AGENT_TYPES.main })[] {
    const all = tables.agents.all() as Agent[];
    return all.map((a) => {
      const provider = a.provider_id ? providerManager.get(a.provider_id) : undefined;
      const typeConfig = a.type ? AGENT_TYPES[a.type as keyof typeof AGENT_TYPES] : undefined;
      return { ...a, provider: provider ? { name: provider.name } : undefined, typeConfig };
    });
  }

  get(id: string): (Agent & { typeConfig?: typeof AGENT_TYPES.main }) | undefined {
    const agent = tables.agents.get(id) as Agent | undefined;
    if (!agent) return undefined;
    const typeConfig = agent.type ? AGENT_TYPES[agent.type as keyof typeof AGENT_TYPES] : undefined;
    return { ...agent, typeConfig };
  }

  create(definition: AgentDefinition): Agent {
    const id = crypto.randomUUID();

    // Get type config for defaults
    const typeConfig = definition.type ? AGENT_TYPES[definition.type] : undefined;

    // Resolve model alias
    const resolvedModel = definition.model
      ? resolveModelAlias(definition.model, undefined)
      : typeConfig?.defaultModel;

    // Use provided system prompt or get from type config
    const systemPrompt =
      definition.system_prompt || typeConfig?.systemPrompt || AGENT_TYPE_PROMPTS.main;

    const agent: Agent = {
      id,
      name: definition.name,
      type: definition.type || "main",
      model: resolvedModel,
      provider_id: definition.provider_id,
      fallback_provider_id: definition.fallback_provider_id,
      system_prompt: systemPrompt,
      tools: definition.tools || typeConfig?.tools || builtinTools,
      config: definition.config || {},
      status: "stopped",
      memory_enabled: definition.memory_enabled || false,
    };

    tables.agents.create(agent);
    return agent;
  }

  // Create a default agent with sensible defaults - matches Clawdbot's default agent
  createDefault(): Agent {
    // Find any provider with API key
    const providers = providerManager.list();
    const hasAuth = providers.find((p) => p.api_key || p.access_token);
    const defaultProvider = hasAuth || providers[0];
    const providerInfo = defaultProvider?.info;

    return this.create({
      name: "Mini",
      type: "research",
      model: providerInfo?.models?.[0]?.id || "MiniMax-M2.1",
      provider_id: defaultProvider?.id,
      system_prompt: AGENT_TYPE_PROMPTS.research,
      tools: builtinTools,
      memory_enabled: true,
    });
  }

  // Create agent using Clawdbot-style full system prompt
  async createWithSystemPrompt(definition: Omit<AgentDefinition, "system_prompt">): Promise<Agent> {
    const typeConfig = definition.type ? AGENT_TYPES[definition.type] : undefined;
    const homeDir = process.env.HOME || homedir();

    // Load eligible skills
    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: undefined,
      config: {},
      modelDisplay: definition.model || typeConfig?.defaultModel || "MiniMax-M2.1",
      tools: (definition.tools || builtinTools).map((t) => t.name),
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

    // Resolve model alias if model is being updated
    let resolvedModel = updates.model;
    if (resolvedModel) {
      resolvedModel = resolveModelAlias(resolvedModel, undefined);
    }

    const updated: Partial<Agent> = {
      name: updates.name || existing.name,
      type: updates.type || existing.type,
      model: resolvedModel || existing.model,
      provider_id: updates.provider_id !== undefined ? updates.provider_id : existing.provider_id,
      fallback_provider_id:
        updates.fallback_provider_id !== undefined
          ? updates.fallback_provider_id
          : existing.fallback_provider_id,
      system_prompt:
        updates.system_prompt !== undefined ? updates.system_prompt : existing.system_prompt,
      tools: updates.tools || existing.tools,
      memory_enabled:
        updates.memory_enabled !== undefined ? updates.memory_enabled : existing.memory_enabled,
      config:
        updates.config || (existing.config ? JSON.parse(existing.config as unknown as string) : {}),
    };

    tables.agents.update(id, updated);
    return { ...existing, ...updated } as Agent;
  }

  async start(id: string): Promise<boolean> {
    const agent = this.get(id);
    if (!agent) return false;

    // Build system prompt with current config
    const homeDir = process.env.HOME || homedir();

    // Load eligible skills
    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const eligibleSkills = filterEligibleSkills(allSkills, context);

    const systemPrompt = buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: { name: agent.name, config: agent.config as string | undefined },
      config: {},
      modelDisplay: agent.model || "MiniMax-M2.1",
      tools: this.getAgentTools(agent).map((t) => t.name),
      skills: eligibleSkills,
    });

    // Initialize running state with system message
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

  // Send a message to a running agent
  async message(id: string, content: string): Promise<{ response: string; thinking?: string }> {
    const state = this.runningAgents.get(id);
    if (!state) {
      throw new Error("Agent is not running. Start the agent first.");
    }

    state.lastActive = new Date();

    // Add user message
    state.messages.push({ role: "user", content });

    // Execute the agent
    const result = await this.executeWithState(state);

    // Add assistant response to history
    state.messages.push({ role: "assistant", content: result.response });

    return result;
  }

  // Execute agent with its current state
  private async executeWithState(
    state: RunningAgentState
  ): Promise<{ response: string; thinking?: string }> {
    const { agent, messages } = state;

    // Get provider
    if (!agent.provider_id) {
      return { response: this.generateFallbackResponse(messages) };
    }

    const provider = providerManager.getWithCredentials(agent.provider_id);
    if (!provider) {
      return { response: this.generateFallbackResponse(messages) };
    }

    const fullMessages = messages;

    // Check if current provider supports function calling
    const providerConfig = provider.provider as string;
    const supportsTools = true;

    let tools: ToolDefinition[] = [];
    if (supportsTools) {
      tools = this.getAgentTools(agent);
    }

    // Call LLM
    try {
      const result = await this.callLLM(provider, agent.model, fullMessages, tools);
      return { response: result.content, thinking: result.thinking };
    } catch (error) {
      console.error("[Agent] LLM call failed:", error);

      // Try fallback provider
      if (agent.fallback_provider_id && provider.provider !== agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLM(
              fallbackProvider,
              agent.model,
              fullMessages,
              tools
            );
            return { response: fallbackResult.content, thinking: fallbackResult.thinking };
          } catch (fallbackError) {
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
          }
        }
      }

      return { response: this.generateFallbackResponse(messages) };
    }
  }

  // Get conversation history for a running agent
  getHistory(id: string): AgentMessage[] {
    const state = this.runningAgents.get(id);
    if (!state) return [];
    return [...state.messages];
  }

  // Clear conversation history for a running agent but keep system prompt
  clearHistory(id: string): boolean {
    const state = this.runningAgents.get(id);
    if (!state) return false;

    // Keep only the system message
    state.messages = state.messages.filter((m) => m.role === "system");
    return true;
  }

  // Check if agent is running
  isRunning(id: string): boolean {
    return this.runningAgents.has(id);
  }

  // Get agent state (if running)
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

  // Execute agent with a message
  async execute(
    agentId: string,
    messages: AgentMessage[],
    options?: { stream?: boolean; useTools?: boolean }
  ): Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }> {
    const agent = this.get(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    // Get provider
    if (!agent.provider_id) {
      return { content: this.generateFallbackResponse(messages) };
    }

    let provider = providerManager.getWithCredentials(agent.provider_id);
    if (!provider) {
      return { content: this.generateFallbackResponse(messages) };
    }

    // Build system message - always use fresh system prompt with tool guidance
    // This ensures new tool guidance (like open_url) is always included
    const freshSystemPrompt = getDefaultSystemPrompt(agent.type || "main");
    const systemMessage: AgentMessage = {
      role: "system",
      content: freshSystemPrompt,
    };

    const fullMessages = [systemMessage, ...messages];

    // Check if current provider supports function calling
    const providerConfig = provider.provider as string;
    // Kimi Code supports tool_calls in OpenAI-compatible format
    const supportsTools = true;

    const needTools = options?.useTools !== false;

    // If tools are needed but provider doesn't support them, try fallback provider
    let tools: ToolDefinition[] = [];
    if (needTools) {
      if (supportsTools) {
        tools = this.getAgentTools(agent);
      } else if (agent.fallback_provider_id) {
        // Try fallback provider for tool support
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          provider = fallbackProvider;
          tools = this.getAgentTools(agent);
        }
      }
    }

    // Call LLM
    try {
      const result = await this.callLLM(provider, agent.model, fullMessages, tools);
      return result;
    } catch (error) {
      console.error("[Agent] LLM call failed:", error);

      // Try fallback provider if primary failed and we haven't tried it yet
      if (agent.fallback_provider_id && provider.provider !== agent.fallback_provider_id) {
        const fallbackProvider = providerManager.getWithCredentials(agent.fallback_provider_id);
        if (fallbackProvider) {
          try {
            const fallbackResult = await this.callLLM(
              fallbackProvider,
              agent.model,
              fullMessages,
              tools
            );
            return fallbackResult;
          } catch (fallbackError) {
            console.error("[Agent] Fallback LLM call also failed:", fallbackError);
          }
        }
      }

      return { content: this.generateFallbackResponse(messages) };
    }
  }

  private getAgentTools(agent: Agent): ToolDefinition[] {
    // If agent has tools defined, try to parse them
    if (agent.tools) {
      // Check if it's an array
      if (Array.isArray(agent.tools)) {
        return agent.tools;
      }
      // Check if it's a JSON string
      if (typeof agent.tools === "string") {
        try {
          const parsed = JSON.parse(agent.tools);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
    // Fall back to built-in tools
    return builtinTools;
  }

  // Public method to call LLM - can be used by API handlers
  async callLLM(
    provider: Awaited<ReturnType<typeof providerManager.get>>,
    model: string | undefined,
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: Array<{ name: string; result: unknown }>;
  }> {
    return this.callLLMInternal(provider, model, messages, tools);
  }

  private async callLLMInternal(
    provider: ReturnType<typeof providerManager.get>,
    model: string | undefined,
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: Array<{ name: string; result: unknown }>;
  }> {
    if (!provider) {
      throw new Error("Provider not found");
    }

    const providerInfo = provider as {
      provider: string;
      base_url?: string;
      api_key?: string;
      access_token?: string;
    };
    const providerConfig = providerInfo.provider;
    const baseUrl = providerInfo.base_url || this.getProviderBaseUrl(providerConfig);
    const auth = providerInfo.api_key || providerInfo.access_token;

    if (!auth) {
      throw new Error("No API key available");
    }

    const modelId = model || this.getDefaultModel(providerConfig);

    // Extract custom headers from provider if available (e.g., User-Agent for Kimi Code)
    const customHeaders = (providerInfo as { headers?: Record<string, string> }).headers || {};

    // MiniMax uses Anthropic Messages API format
    if (providerConfig === "minimax") {
      return this.callAnthropicAPI(baseUrl, auth, modelId, messages, tools, providerConfig);
    }

    // Kimi Code uses OpenAI-compatible format with custom headers (User-Agent: KimiCLI/0.77)
    if (providerConfig === "kimi-code") {
      return this.callOpenAICompatAPI(baseUrl, auth, modelId, messages, tools, customHeaders);
    }

    // Anthropic uses Messages API
    if (providerConfig === "anthropic") {
      return this.callAnthropicAPI(baseUrl, auth, modelId, messages, tools, providerConfig);
    }

    // Other providers use standard OpenAI format
    return this.callOpenAIAPI(baseUrl, auth, modelId, messages, tools);
  }

  private async callOpenAICompatAPI(
    baseUrl: string,
    auth: string,
    modelId: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    customHeaders?: Record<string, string>,
    providerConfig?: string
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: Array<{ name: string; result: unknown }>;
  }> {
    // MiniMax uses OpenAI /chat/completions but with x-api-key header
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 4096,
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
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth}`,
      ...customHeaders, // Merge custom headers (e.g., User-Agent for Kimi Code)
    };

    console.log(`[Agent] Sending request with headers:`, JSON.stringify(Object.keys(headers)));

    // Broadcast generating status before LLM call
    broadcastStatus({ status: "generating", timestamp: Date.now() });

    // Start timing
    const startTime = performance.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    // End timing
    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    // Track token usage for OpenAI-compatible API with duration
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

    // AGENTIC LOOP: Continue executing tools until LLM stops calling them
    const maxIterations = 10; // Prevent infinite loops
    let iterations = 0;
    // Use Record type for flexible message shape that includes tool_calls and tool_call_id
    const currentMessages: Record<string, unknown>[] = [...messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))];
    const allToolCalls: Array<{ name: string; result: unknown }> = [];
    let finalContent = message.content || "";

    while (iterations < maxIterations) {
      iterations++;

      // Check if LLM wants to call tools
      if (!message.tool_calls || message.tool_calls.length === 0) {
        // LLM is done - no more tool calls
        break;
      }

      console.log(`[Agent] Agentic loop iteration ${iterations}: ${message.tool_calls.length} tool calls`);

      // Execute all tool calls from this iteration
      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function?.name;
        const toolCallId = toolCall.id;
        const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};

        if (toolName && hasTool(toolName)) {
          try {
            broadcastStatus({ status: "tool_executing", timestamp: Date.now(), detail: toolName });
            const result = await executeTool(toolName, args);
            allToolCalls.push({ name: toolName, result });
            toolResults.push({
              tool_call_id: toolCallId,
              role: "tool",
              content: JSON.stringify(result),
            });
          } catch (error) {
            allToolCalls.push({ name: toolName, result: { error: (error as Error).message } });
            toolResults.push({
              tool_call_id: toolCallId,
              role: "tool",
              content: JSON.stringify({ error: (error as Error).message }),
            });
          }
        }
      }

      // Add assistant message with tool calls and tool results to conversation
      currentMessages.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: message.tool_calls,
      });
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }

      // Call LLM again with updated conversation (includes tool results)
      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: 4096,
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

      const loopResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(loopRequestBody),
      });

      if (!loopResponse.ok) {
        const loopError = await loopResponse.text();
        throw new Error(`API error in agentic loop: ${loopResponse.status} - ${loopError}`);
      }

      const loopData = (await loopResponse.json()) as OpenAIResponse;
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        break;
      }

      // Update final content with LLM's latest response
      if (message.content) {
        finalContent = message.content;
      }
    }

    if (iterations >= maxIterations) {
      console.log(`[Agent] Agentic loop reached max iterations (${maxIterations})`);
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
    providerConfig: string
  ): Promise<{
    content: string;
    thinking?: string;
    tool_calls?: Array<{ name: string; result: unknown }>;
  }> {
    // Build Anthropic Messages API format
    // Extract system message separately as Anthropic expects it in a different field
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
      max_tokens: 4096,
    };

    // Add system message as a separate field
    if (systemMessage) {
      requestBody.system = systemMessage.content;
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.input_schema || { type: "object", properties: {} },
      }));
      // Force tool selection to ensure tools are actually used
      requestBody.tool_choice = { type: "any" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": auth,
      "anthropic-version": "2023-06-01",
    };

    // Broadcast generating status before LLM call
    broadcastStatus({ status: "generating", timestamp: Date.now() });

    // Start timing
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

    // End timing
    const durationMs = Math.round(performance.now() - startTime);

    // Track token usage for Anthropic API with duration
    if (data.usage) {
      const inputTokens = data.usage.input_tokens || 0;
      const outputTokens = data.usage.output_tokens || 0;
      trackTokenUsage(modelId, providerConfig, baseUrl, inputTokens, outputTokens, durationMs);
    }

    // AGENTIC LOOP: Continue executing tools until LLM stops calling them
    const maxIterations = 10;
    let iterations = 0;
    let currentData = data;

    // Build conversation for loop - Anthropic uses content arrays
    const currentMessages: Record<string, unknown>[] = chatMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const allToolCalls: Array<{ name: string; result: unknown }> = [];
    let finalContent = currentData.content?.find((c) => c.type === "text")?.text || "";
    const thinking = currentData.content?.find((c) => c.type === ("thinking" as string))?.text || undefined;

    while (iterations < maxIterations) {
      iterations++;

      // Check for tool_use blocks
      const toolUseBlocks = currentData.content?.filter((c: { type: string }) => c.type === "tool_use") || [];

      if (toolUseBlocks.length === 0) {
        // No more tool calls - LLM is done
        break;
      }

      console.log(`[Agent] Anthropic agentic loop iteration ${iterations}: ${toolUseBlocks.length} tool calls`);

      // Execute all tool calls
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name;
        const toolUseId = toolUse.id || "";  // Fallback to empty string if undefined
        const args = toolUse.input || {};

        if (toolName && hasTool(toolName)) {
          try {
            broadcastStatus({ status: "tool_executing", timestamp: Date.now(), detail: toolName });
            const result = await executeTool(toolName, args);
            allToolCalls.push({ name: toolName, result });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUseId,
              content: JSON.stringify(result),
            });
          } catch (error) {
            allToolCalls.push({ name: toolName, result: { error: (error as Error).message } });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUseId,
              content: JSON.stringify({ error: (error as Error).message }),
            });
          }
        }
      }

      // Add assistant message with tool use and user message with tool results
      currentMessages.push({
        role: "assistant",
        content: currentData.content, // Keep full content array including tool_use blocks
      });
      currentMessages.push({
        role: "user",
        content: toolResults, // Anthropic expects tool_result in user message
      });

      // Call LLM again with tool results
      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: 4096,
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

      // Update final content with LLM's latest text response
      const latestText = currentData.content?.find((c) => c.type === "text")?.text;
      if (latestText) {
        finalContent = latestText;
      }
    }

    if (iterations >= maxIterations) {
      console.log(`[Agent] Anthropic agentic loop reached max iterations (${maxIterations})`);
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
    tools: ToolDefinition[]
  ): Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }> {
    // Build properly ordered messages: system first, then chat messages
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
      max_tokens: 4096,
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

    // Broadcast generating status before LLM call
    broadcastStatus({ status: "generating", timestamp: Date.now() });

    // Start timing
    const startTime = performance.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    // End timing
    const durationMs = Math.round(performance.now() - startTime);

    const choice = data.choices?.[0];
    let message = choice?.message;

    // Track token usage for OpenAI API with duration
    if (data.usage) {
      const inputTokens = data.usage.prompt_tokens || 0;
      const outputTokens = data.usage.completion_tokens || 0;
      trackTokenUsage(modelId, "openai", baseUrl, inputTokens, outputTokens, durationMs);
    }

    if (!message) {
      throw new Error("No response from API");
    }

    // AGENTIC LOOP: Continue executing tools until LLM stops calling them
    const maxIterations = 10;
    let iterations = 0;
    const currentMessages: Record<string, unknown>[] = [...chatMessages];
    const allToolCalls: Array<{ name: string; result: unknown }> = [];
    let finalContent = message.content || "";

    while (iterations < maxIterations) {
      iterations++;

      // Check if LLM wants to call tools
      if (!message.tool_calls || message.tool_calls.length === 0) {
        break;
      }

      console.log(`[Agent] OpenAI agentic loop iteration ${iterations}: ${message.tool_calls.length} tool calls`);

      // Execute all tool calls from this iteration
      const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function?.name;
        const toolCallId = toolCall.id;
        let args = {};
        if (typeof toolCall.function?.arguments === "string") {
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error(`[Agent] Failed to parse tool arguments:`, toolCall.function.arguments);
          }
        } else if (toolCall.function?.arguments) {
          args = toolCall.function.arguments;
        }

        if (toolName && hasTool(toolName)) {
          try {
            broadcastStatus({ status: "tool_executing", timestamp: Date.now(), detail: toolName });
            const result = await executeTool(toolName, args);
            allToolCalls.push({ name: toolName, result });
            toolResults.push({
              tool_call_id: toolCallId,
              role: "tool",
              content: JSON.stringify(result),
            });
          } catch (error) {
            allToolCalls.push({ name: toolName, result: { error: (error as Error).message } });
            toolResults.push({
              tool_call_id: toolCallId,
              role: "tool",
              content: JSON.stringify({ error: (error as Error).message }),
            });
          }
        }
      }

      // Add assistant message with tool calls and tool results to conversation
      currentMessages.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: message.tool_calls,
      });
      for (const toolResult of toolResults) {
        currentMessages.push(toolResult);
      }

      // Call LLM again with updated conversation (includes tool results)
      const loopRequestBody: Record<string, unknown> = {
        model: modelId,
        messages: currentMessages,
        max_tokens: 4096,
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

      const loopResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(loopRequestBody),
      });

      if (!loopResponse.ok) {
        const loopError = await loopResponse.text();
        throw new Error(`API error in agentic loop: ${loopResponse.status} - ${loopError}`);
      }

      const loopData = (await loopResponse.json()) as OpenAIResponse;
      const loopChoice = loopData.choices?.[0];
      message = loopChoice?.message as OpenAIMessage;

      if (!message) {
        break;
      }

      // Update final content with LLM's latest response
      if (message.content) {
        finalContent = message.content;
      }
    }

    if (iterations >= maxIterations) {
      console.log(`[Agent] OpenAI agentic loop reached max iterations (${maxIterations})`);
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

    // Proper error fallback - don't mention "production environment"
    return "I apologize, but I encountered an issue processing your request. Please try again or rephrase your message.";
  }
}

export const agentManager = new AgentManager();
