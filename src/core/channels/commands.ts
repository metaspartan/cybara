import db, { tables } from "../database";
import { config } from "../config";
import { getDefaultModel } from "../providers";

type AgentRow = {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
  model?: string | null;
  provider_id?: string | null;
};

type ProviderRow = {
  id: string;
  provider: string;
  name: string;
  api_key?: string | null;
  access_token?: string | null;
};

type ProviderModelRow = {
  model_id?: string | null;
  model_name?: string | null;
};

export interface ChannelCommandContext {
  channelId: string;
  chatId: string | number;
  platform: string;
  sessionId?: string;
  createSessionId?: () => string;
  setSessionId?: (sessionId: string) => void;
}

export interface ChannelSubagentSpawnResult {
  status: string;
  childSessionKey: string;
  runId: string;
  task: string;
  modelApplied?: boolean;
  warning?: string;
}

export type ChannelSubagentSpawnHandler = (
  args: Record<string, unknown>
) => Promise<ChannelSubagentSpawnResult>;

let channelSubagentSpawnHandler: ChannelSubagentSpawnHandler | null = null;

export function setChannelSubagentSpawnHandler(handler: ChannelSubagentSpawnHandler): void {
  channelSubagentSpawnHandler = handler;
}

export function clearChannelSubagentSpawnHandler(): void {
  channelSubagentSpawnHandler = null;
}

interface ParsedCommand {
  command: string;
  args: string[];
}

function parseCommand(input: string): ParsedCommand | null {
  const text = input.trim();
  if (!text.startsWith("/") && !text.startsWith("!")) return null;

  const tokens = text.slice(1).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const commandToken = tokens[0] || "";
  const command = commandToken.split("@")[0].toLowerCase();
  if (!command) return null;

  return {
    command,
    args: tokens.slice(1),
  };
}

function getAgents(): AgentRow[] {
  return (tables.agents.all() as AgentRow[]) || [];
}

function getProviders(): ProviderRow[] {
  return (tables.providers.all() as ProviderRow[]) || [];
}

function getProviderModels(providerId?: string | null): ProviderModelRow[] {
  if (!providerId) return [];
  return (tables.providerModels.byProvider(providerId) as ProviderModelRow[]) || [];
}

function resolveByToken<T extends { id: string; name: string }>(
  token: string,
  items: T[],
  kind: string
): { item?: T; error?: string } {
  if (!token.trim()) return { error: `${kind} is required.` };

  const numeric = Number.parseInt(token, 10);
  if (Number.isFinite(numeric) && numeric >= 1) {
    const byIndex = items[numeric - 1];
    if (byIndex) return { item: byIndex };
    return { error: `${kind} #${numeric} not found.` };
  }

  const needle = token.trim().toLowerCase();

  const exactId = items.find((item) => item.id === token.trim());
  if (exactId) return { item: exactId };

  const exactName = items.find((item) => item.name.toLowerCase() === needle);
  if (exactName) return { item: exactName };

  const partial = items.filter(
    (item) => item.id.toLowerCase().startsWith(needle) || item.name.toLowerCase().includes(needle)
  );

  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) {
    return {
      error: `Multiple ${kind.toLowerCase()}s matched "${token}". Use a number or full ID.`,
    };
  }

  return { error: `${kind} "${token}" not found.` };
}

function getConfiguredDefaultAgentId(): string | undefined {
  const configured = config.get<string>("default_agent_id");
  return typeof configured === "string" && configured.trim() ? configured : undefined;
}

function getDefaultAgent(agents: AgentRow[]): AgentRow | undefined {
  if (agents.length === 0) return undefined;

  const configuredId = getConfiguredDefaultAgentId();
  if (configuredId) {
    const configuredAgent = agents.find((agent) => agent.id === configuredId);
    if (configuredAgent) return configuredAgent;
  }

  return agents.find((agent) => agent.status === "running") || agents[0];
}

function getCurrentProvider(agent: AgentRow, providers: ProviderRow[]): ProviderRow | undefined {
  if (!agent.provider_id) return undefined;
  return providers.find((provider) => provider.id === agent.provider_id);
}

function rotateSession(context: ChannelCommandContext): string | undefined {
  if (!context.createSessionId || !context.setSessionId) return undefined;
  const nextSessionId = context.createSessionId();
  context.setSessionId(nextSessionId);
  return nextSessionId;
}

function formatCommandHelp(): string {
  return [
    "Available management commands:",
    "/help - Show this help",
    "/status - Show agent/provider/channel status",
    "/new - Start a fresh conversation session",
    "/permissions [ask|allow] - Show or set dangerous tool approval mode",
    "/agents - List agents",
    "/agent [id|name|number] - Show or set default agent",
    "/providers - List providers",
    "/provider [id|name|number] - Show or set default agent provider",
    "/models - List models for current agent provider",
    "/model [id|number] - Show or set model for default agent",
    "/subagents spawn <task> - Spawn a deterministic subagent run",
  ].join("\n");
}

function formatAgentsList(agents: AgentRow[]): string {
  if (agents.length === 0) {
    return "No agents configured yet.";
  }

  const defaultAgentId = getDefaultAgent(agents)?.id;
  const providers = getProviders();
  const providerNameById = new Map(providers.map((provider) => [provider.id, provider.name]));

  const lines = agents.map((agent, index) => {
    const marker = agent.id === defaultAgentId ? "⭐" : "•";
    const providerName = agent.provider_id
      ? (providerNameById.get(agent.provider_id) ?? "Unknown provider")
      : "No provider";
    const modelName = agent.model || "default";
    const status = agent.status === "running" ? "running" : "stopped";
    return `${marker} ${index + 1}. ${agent.name} (${status}) - ${providerName} / ${modelName}`;
  });

  return `Agents:\n${lines.join("\n")}`;
}

function formatProvidersList(
  providers: ProviderRow[],
  selectedProviderId?: string | null,
  selectedAgentName?: string
): string {
  if (providers.length === 0) {
    return "No providers configured yet.";
  }

  const lines = providers.map((provider, index) => {
    const selected = selectedProviderId && provider.id === selectedProviderId ? "⭐" : "•";
    const auth = provider.api_key || provider.access_token ? "auth" : "no-auth";
    return `${selected} ${index + 1}. ${provider.name} (${provider.provider}, ${auth})`;
  });

  const header = selectedAgentName
    ? `Providers (⭐ = provider used by ${selectedAgentName}):`
    : "Providers:";
  return `${header}\n${lines.join("\n")}`;
}

function resolveModelToken(token: string, models: ProviderModelRow[]): string | undefined {
  if (!token.trim()) return undefined;

  const numeric = Number.parseInt(token, 10);
  if (Number.isFinite(numeric) && numeric >= 1) {
    const byIndex = models[numeric - 1];
    return byIndex?.model_id || undefined;
  }

  const needle = token.trim().toLowerCase();
  const allModelIds = models
    .map((model) => model.model_id)
    .filter(
      (modelId): modelId is string => typeof modelId === "string" && modelId.trim().length > 0
    );

  const exact = allModelIds.find((modelId) => modelId.toLowerCase() === needle);
  if (exact) return exact;

  const byName = models.find(
    (model) => (model.model_name || "").toLowerCase() === needle
  )?.model_id;
  if (byName) return byName;

  const partial = allModelIds.filter((modelId) => modelId.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];

  return undefined;
}

function getStatusSummary(): string {
  const agents = getAgents();
  const providers = getProviders();
  const channels = tables.channels.all() as Array<{ enabled?: boolean }>;
  const runningAgents = agents.filter((agent) => agent.status === "running").length;
  const enabledChannels = channels.filter((channel) => !!channel.enabled).length;
  const defaultAgent = getDefaultAgent(agents);
  const toolApprovalMode = config.getToolApprovalMode();
  const toolApprovalSummary =
    toolApprovalMode === "ask"
      ? "Tool approvals: ask before dangerous tools"
      : "Tool approvals: always allow";

  return [
    "Status:",
    `Agents: ${agents.length} total, ${runningAgents} running`,
    `Providers: ${providers.length} configured`,
    `Channels: ${enabledChannels} enabled`,
    toolApprovalSummary,
    defaultAgent
      ? `Default agent: ${defaultAgent.name} (${defaultAgent.model || "default model"})`
      : "Default agent: none",
  ].join("\n");
}

function updateAgentProviderAndModel(agentId: string, providerId: string, model: string): void {
  db.query(
    "UPDATE agents SET provider_id = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(providerId, model, agentId);
}

function updateAgentModel(agentId: string, model: string): void {
  db.query("UPDATE agents SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    model,
    agentId
  );
}

export async function handleChannelManagementCommand(
  input: string,
  context: ChannelCommandContext
): Promise<string | null> {
  const parsed = parseCommand(input);
  if (!parsed) return null;

  const { command, args } = parsed;
  const joinedArgs = args.join(" ").trim();

  if (command === "start" || command === "help") {
    return formatCommandHelp();
  }

  if (command === "new") {
    const newSessionId = rotateSession(context);
    if (!newSessionId) {
      return "Starting a fresh session is not supported in this channel context.";
    }
    return `Started a new session: ${newSessionId.slice(0, 8)}...`;
  }

  if (command === "status") {
    return getStatusSummary();
  }

  if (command === "permissions" || command === "approval" || command === "approvals") {
    const currentMode = config.getToolApprovalMode();
    if (
      !joinedArgs ||
      joinedArgs.toLowerCase() === "show" ||
      joinedArgs.toLowerCase() === "status"
    ) {
      return [
        "Tool permission mode:",
        currentMode === "ask"
          ? "ask (dangerous tools require explicit approval)"
          : "allow (dangerous tools run normally)",
        "Use /permissions ask or /permissions allow.",
      ].join("\n");
    }

    const normalized = joinedArgs.toLowerCase().replace(/[\s-]+/g, "_");
    const nextMode =
      normalized === "ask" || normalized === "prompt" || normalized === "confirm"
        ? "ask"
        : normalized === "allow" ||
            normalized === "always" ||
            normalized === "always_allow" ||
            normalized === "auto" ||
            normalized === "on"
          ? "always_allow"
          : undefined;

    if (!nextMode) {
      return "Unknown permissions mode. Use /permissions ask or /permissions allow.";
    }

    config.setToolApprovalMode(nextMode);
    return nextMode === "ask"
      ? "Tool permission mode set to ask. Dangerous tools now require explicit approval."
      : "Tool permission mode set to allow. Dangerous tools can run normally.";
  }

  if (command === "agents") {
    return formatAgentsList(getAgents());
  }

  if (command === "agent") {
    const agents = getAgents();
    if (agents.length === 0) return "No agents configured yet.";

    if (!joinedArgs || joinedArgs.toLowerCase() === "show") {
      const current = getDefaultAgent(agents);
      if (!current) return "No agents configured yet.";
      return [
        `Current default agent: ${current.name}`,
        `ID: ${current.id}`,
        `Model: ${current.model || "default"}`,
        `Status: ${current.status || "stopped"}`,
        "Use /agent <id|name|number> to switch.",
      ].join("\n");
    }

    if (joinedArgs.toLowerCase() === "list") {
      return formatAgentsList(agents);
    }

    const resolved = resolveByToken(joinedArgs, agents, "Agent");
    if (!resolved.item) {
      return resolved.error || "Agent not found.";
    }

    config.set("default_agent_id", resolved.item.id);
    const rotated = rotateSession(context);

    return rotated
      ? `Default agent set to ${resolved.item.name}. Started a new session (${rotated.slice(0, 8)}...) so changes apply immediately.`
      : `Default agent set to ${resolved.item.name}.`;
  }

  if (command === "providers") {
    const providers = getProviders();
    const defaultAgent = getDefaultAgent(getAgents());
    return formatProvidersList(providers, defaultAgent?.provider_id, defaultAgent?.name);
  }

  if (command === "provider") {
    const agents = getAgents();
    const agent = getDefaultAgent(agents);
    if (!agent) return "No agents configured yet.";

    const providers = getProviders();
    if (providers.length === 0) return "No providers configured yet.";

    if (!joinedArgs || joinedArgs.toLowerCase() === "show") {
      const currentProvider = getCurrentProvider(agent, providers);
      if (!currentProvider) {
        return [
          `Default agent: ${agent.name}`,
          "Provider: none",
          "Use /provider <id|name|number> to set one.",
        ].join("\n");
      }

      return [
        `Default agent: ${agent.name}`,
        `Provider: ${currentProvider.name} (${currentProvider.provider})`,
        "Use /provider <id|name|number> to switch.",
      ].join("\n");
    }

    const resolved = resolveByToken(joinedArgs, providers, "Provider");
    if (!resolved.item) return resolved.error || "Provider not found.";
    const nextProvider = resolved.item;

    const providerModels = getProviderModels(nextProvider.id)
      .map((model) => model.model_id)
      .filter(
        (modelId): modelId is string => typeof modelId === "string" && modelId.trim().length > 0
      );

    let nextModel = agent.model || "";
    if (!nextModel) {
      nextModel = providerModels[0] || getDefaultModel(nextProvider.provider);
    } else if (
      providerModels.length > 0 &&
      !providerModels.some((modelId) => modelId.toLowerCase() === nextModel.toLowerCase())
    ) {
      nextModel = providerModels[0];
    }

    updateAgentProviderAndModel(agent.id, nextProvider.id, nextModel);
    const rotated = rotateSession(context);

    const message = [
      `Default agent "${agent.name}" now uses provider ${nextProvider.name}.`,
      `Model: ${nextModel || "default"}`,
    ];
    if (rotated) {
      message.push(
        `Started a new session (${rotated.slice(0, 8)}...) so changes apply immediately.`
      );
    }
    return message.join("\n");
  }

  if (command === "models") {
    const agents = getAgents();
    const agent = getDefaultAgent(agents);
    if (!agent) return "No agents configured yet.";

    const providers = getProviders();
    const provider = getCurrentProvider(agent, providers);
    if (!provider) {
      return `Default agent "${agent.name}" has no provider. Set one with /provider first.`;
    }

    const models = getProviderModels(provider.id).filter(
      (model) => typeof model.model_id === "string" && model.model_id.trim().length > 0
    );
    if (models.length === 0) {
      return `No cached models found for provider ${provider.name}. You can still set one with /model <id>.`;
    }

    const currentModel = (agent.model || "").toLowerCase();
    const lines = models.slice(0, 40).map((model, index) => {
      const modelId = model.model_id as string;
      const marker = modelId.toLowerCase() === currentModel ? "⭐" : "•";
      const label =
        model.model_name && model.model_name !== modelId ? ` (${model.model_name})` : "";
      return `${marker} ${index + 1}. ${modelId}${label}`;
    });

    return `Models for ${provider.name}:\n${lines.join("\n")}`;
  }

  if (command === "model") {
    const agents = getAgents();
    const agent = getDefaultAgent(agents);
    if (!agent) return "No agents configured yet.";

    if (!joinedArgs || joinedArgs.toLowerCase() === "show") {
      return [
        `Default agent: ${agent.name}`,
        `Current model: ${agent.model || "default"}`,
        "Use /model <id|number> to change.",
      ].join("\n");
    }

    const providers = getProviders();
    const provider = getCurrentProvider(agent, providers);
    const providerModels = provider ? getProviderModels(provider.id) : [];

    const resolvedFromProvider = resolveModelToken(joinedArgs, providerModels);
    const nextModel = resolvedFromProvider || joinedArgs;

    updateAgentModel(agent.id, nextModel);
    const rotated = rotateSession(context);

    const providerLabel = provider ? ` (${provider.name})` : "";
    const lines = [`Model for default agent "${agent.name}" set to ${nextModel}${providerLabel}.`];
    if (!resolvedFromProvider && providerModels.length > 0) {
      lines.push("Note: model was not in cached provider model list, but was applied.");
    }
    if (rotated) {
      lines.push(`Started a new session (${rotated.slice(0, 8)}...) so changes apply immediately.`);
    }
    return lines.join("\n");
  }

  if (command === "subagents" || command === "subagent") {
    if (args.length === 0 || args[0]?.toLowerCase() === "help") {
      return ["Subagent commands:", "/subagents spawn <task> - Start a one-off subagent run"].join(
        "\n"
      );
    }

    const action = (args[0] || "").toLowerCase();
    if (action !== "spawn") {
      return `Unsupported subagent action "${args[0]}". Use /subagents spawn <task>.`;
    }

    const task = args.slice(1).join(" ").trim();
    if (!task) {
      return "Task is required. Usage: /subagents spawn <task>";
    }

    if (!channelSubagentSpawnHandler) {
      return "Subagent spawn is not configured for this runtime.";
    }

    const requesterSessionKey =
      context.sessionId || `${context.platform}:${context.channelId}:${String(context.chatId)}`;
    const spawned = await channelSubagentSpawnHandler({
      task,
      _requesterSessionKey: requesterSessionKey,
      label: `channel:${context.platform}`,
    });

    if (spawned.status !== "accepted") {
      return spawned.warning || `Subagent spawn failed with status: ${spawned.status}`;
    }

    return [
      `Subagent spawned successfully.`,
      `Run ID: ${spawned.runId}`,
      `Session: ${spawned.childSessionKey}`,
      `Task: ${spawned.task}`,
    ].join("\n");
  }

  return null;
}
