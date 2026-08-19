import db, { tables } from "../database";
import { config } from "../config";
import { getDefaultModel } from "../providers";
import { homedir } from "os";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import {
  listChannelRuntimePending,
  listChannelRuntimeSessions,
  queueChannelRuntimeMessage,
  sendChannelRuntimeMessage,
  steerChannelRuntimeMessage,
  stopChannelRuntimeMessage,
  type ChannelRuntimeMessage,
  type ChannelRuntimePendingMessage,
} from "./chat-runtime";
import { handleSessionGoalCommand } from "../session-goals";
import {
  configuredChannelUsesModelRouter,
  resolveChannelAgentId,
  setChannelAgentId,
  setChannelModelRouter,
} from "./agent-selection";
import { isModelRouterEnabled } from "../router";

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
  allowSecuritySettings?: boolean;
}

export type SharedChannelCommandContext = Pick<
  ChannelCommandContext,
  "channelId" | "chatId" | "platform" | "sessionId"
>;

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

function getDefaultAgent(agents: AgentRow[], channelId?: string): AgentRow | undefined {
  if (agents.length === 0) return undefined;
  const selectedId = resolveChannelAgentId(channelId, agents);
  return selectedId ? agents.find((agent) => agent.id === selectedId) : undefined;
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

type SessionSelectionResult = {
  sessionId?: string;
  messageCount?: number;
  error?: string;
};

function parseSessionToken(token: string): string {
  return token.trim().replace(/\.{3}$/, "");
}

function resolveSessionSelection(
  token: string,
  sessions: Array<{ id: string; messageCount: number }>
): SessionSelectionResult {
  const normalized = parseSessionToken(token);
  if (!normalized) {
    return {
      error: "Session target is required. Use /switch <number|session_id_prefix>.",
    };
  }

  if (/^\d+$/.test(normalized)) {
    const sessionNumber = Number.parseInt(normalized, 10);
    if (!Number.isFinite(sessionNumber) || sessionNumber < 1) {
      return { error: "Session number must be 1 or greater." };
    }
    const byIndex = sessions[sessionNumber - 1];
    if (!byIndex) {
      return {
        error: `Session #${sessionNumber} not found. Use /sessions to list available sessions.`,
      };
    }
    return { sessionId: byIndex.id, messageCount: byIndex.messageCount };
  }

  const needle = normalized.toLowerCase();
  const exact = sessions.find((session) => session.id.toLowerCase() === needle);
  if (exact) {
    return { sessionId: exact.id, messageCount: exact.messageCount };
  }

  const prefixMatches = sessions.filter((session) => session.id.toLowerCase().startsWith(needle));
  if (prefixMatches.length === 1) {
    const match = prefixMatches[0];
    return { sessionId: match.id, messageCount: match.messageCount };
  }
  if (prefixMatches.length > 1) {
    return {
      error: `Multiple sessions match "${normalized}". Use a longer prefix or a session number.`,
    };
  }

  const containsMatches = sessions.filter((session) => session.id.toLowerCase().includes(needle));
  if (containsMatches.length === 1) {
    const match = containsMatches[0];
    return { sessionId: match.id, messageCount: match.messageCount };
  }
  if (containsMatches.length > 1) {
    return {
      error: `Multiple sessions match "${normalized}". Use a longer prefix or a session number.`,
    };
  }

  const persisted = tables.chatSessions.get(normalized) as { id?: string } | undefined;
  if (persisted && typeof persisted.id === "string" && persisted.id.trim().length > 0) {
    return { sessionId: persisted.id };
  }

  return {
    error: `Session "${normalized}" not found. Use /sessions to list available sessions.`,
  };
}

function formatCommandHelp(): string {
  return [
    "⚡ *Cybara Commands*",
    "Available management commands:",
    "",
    "📋 *Sessions:*",
    "/new — Start a fresh conversation",
    "/sessions — List recent sessions",
    "/switch <number|session_id_prefix> — Switch to an existing session",
    "/session [target] — Show current session or switch to target",
    "/workspace [path] — Show or set session workspace (~/path supported)",
    "/workspace clear — Reset workspace to default",
    "/goal <objective> — Keep working toward a session goal (/loop alias)",
    "/queue <message> — Queue a follow-up for the active run",
    "/pending — List queued follow-ups",
    "/steer <number|id> — Inject a queued follow-up now",
    "/stop — Stop the active run",
    "/permissions [ask|allow] — Dangerous tool approval mode",
    "",
    "🤖 *Agents & Models:*",
    "/status — Agent, provider, and channel status",
    "/agents — List all agents",
    "/agent [id|name|#] — Show or switch default agent",
    "/providers — List all providers",
    "/provider [id|name|#] — Show or switch provider",
    "/models — List models for current provider",
    "/model [id|#] — Show or switch model",
    "",
    "🔧 *Advanced:*",
    "/subagents spawn <task> — Run a one-off subagent",
    "/help — Show this help",
  ].join("\n");
}

function formatPendingMessages(messages: ChannelRuntimePendingMessage[]): string {
  if (messages.length === 0) return "No pending follow-ups.";
  return [
    "Pending follow-ups:",
    ...messages.map(
      (message, index) =>
        `${index + 1}. ${message.mode === "steering" ? "Steering" : "Queued"}: ${message.content}`
    ),
  ].join("\n");
}

function resolvePendingMessageId(
  target: string,
  messages: ChannelRuntimePendingMessage[]
): string | null {
  const normalized = target.trim().replace(/^#/, "");
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return messages[Number.parseInt(normalized, 10) - 1]?.id || null;
  const exact = messages.find((message) => message.id === normalized);
  if (exact) return exact.id;
  const matches = messages.filter((message) => message.id.startsWith(normalized));
  return matches.length === 1 ? matches[0].id : null;
}

function formatAgentsList(agents: AgentRow[], channelId?: string): string {
  if (agents.length === 0) {
    return "No agents configured yet.";
  }

  const defaultAgentId = getDefaultAgent(agents, channelId)?.id;
  const providers = getProviders();
  const providerNameById = new Map(providers.map((provider) => [provider.id, provider.name]));

  const lines = agents.map((agent, index) => {
    const marker = agent.id === defaultAgentId ? "⭐" : "•";
    const providerName = agent.provider_id
      ? (providerNameById.get(agent.provider_id) ?? "Unknown provider")
      : "No provider";
    const modelName = agent.model || "default";
    return `${marker} ${index + 1}. ${agent.name} - ${providerName} / ${modelName}`;
  });

  const routerLine = isModelRouterEnabled()
    ? "\nModel Router is available with /agent router."
    : "";
  return `Agents:\n${lines.join("\n")}${routerLine}`;
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

function getStatusSummary(channelId?: string): string {
  const agents = getAgents();
  const providers = getProviders();
  const channels = tables.channels.all() as Array<{ enabled?: boolean }>;
  const enabledChannels = channels.filter((channel) => !!channel.enabled).length;
  const defaultAgent = getDefaultAgent(agents, channelId);
  const useModelRouter = configuredChannelUsesModelRouter(channelId) && isModelRouterEnabled();
  const toolApprovalMode = config.getToolApprovalMode();
  const toolApprovalSummary =
    toolApprovalMode === "ask"
      ? "Tool approvals: ask before dangerous tools"
      : "Tool approvals: always allow";

  return [
    "Status:",
    `Agents: ${agents.length} available`,
    `Providers: ${providers.length} configured`,
    `Channels: ${enabledChannels} enabled`,
    toolApprovalSummary,
    useModelRouter
      ? "Channel routing: Model Router"
      : defaultAgent
        ? `Channel agent: ${defaultAgent.name} (${defaultAgent.model || "default model"})`
        : "Channel agent: none",
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

  if (command === "goal" || command === "loop") {
    const sessionId = context.sessionId || rotateSession(context);
    if (!sessionId) {
      return "Goal mode needs an active session in this channel context. Use /new first.";
    }
    const commandText = `/${command}${joinedArgs ? ` ${joinedArgs}` : ""}`;
    const result = handleSessionGoalCommand(sessionId, commandText);
    if (result.goal?.status === "active") {
      const kickoff: ChannelRuntimeMessage = {
        role: "user",
        content: result.goal.objective,
        timestamp: new Date().toISOString(),
      };
      sendChannelRuntimeMessage(sessionId, kickoff);
    }
    return result.response || "Goal command handled.";
  }

  if (command === "pending") {
    if (!context.sessionId) return "No active session in this channel context.";
    return formatPendingMessages(listChannelRuntimePending(context.sessionId));
  }

  if (command === "queue") {
    if (!context.sessionId) return "Queueing needs an active session. Use /new first.";
    if (!joinedArgs) return "Usage: /queue <message>";
    const result = await queueChannelRuntimeMessage(context.sessionId, joinedArgs);
    if (!result) return "Queueing is unavailable in this channel context.";
    return result.queued
      ? `Queued follow-up.\n${formatPendingMessages(result.pendingMessages)}`
      : "The session was idle, so the message started immediately.";
  }

  if (command === "steer") {
    if (!context.sessionId) return "Steering needs an active session. Use /new first.";
    const messages = listChannelRuntimePending(context.sessionId);
    const pendingId = resolvePendingMessageId(args[0] || "", messages);
    if (!pendingId) return "Usage: /steer <number|pending_id>. Use /pending to list follow-ups.";
    const result = await steerChannelRuntimeMessage(context.sessionId, pendingId);
    if (!result) return "Steering is unavailable in this channel context.";
    if (!result.success) return result.error || "Failed to steer the follow-up.";
    return `Steered follow-up into the active conversation.\n${formatPendingMessages(result.pendingMessages)}`;
  }

  if (command === "stop") {
    if (!context.sessionId) return "Stopping needs an active session.";
    const result = await stopChannelRuntimeMessage(context.sessionId);
    if (!result) return "Stopping is unavailable in this channel context.";
    return result.stopped ? "Stopped the active response." : result.error || "No active response.";
  }

  if (command === "new") {
    const newSessionId = rotateSession(context);
    if (!newSessionId) {
      return "Starting a fresh session is not supported in this channel context.";
    }
    return `Started a new session: ${newSessionId.slice(0, 8)}...`;
  }

  if (command === "sessions") {
    const allSessions = await listChannelRuntimeSessions();
    if (allSessions.length === 0) {
      return "No sessions found yet. Use /new to start a fresh session.";
    }

    const sessions = allSessions.slice(0, 20);
    const lines = sessions.map((session, index) => {
      const marker = context.sessionId === session.id ? "⭐" : "•";
      const createdAt = Number.isFinite(Date.parse(session.createdAt))
        ? new Date(session.createdAt).toLocaleString()
        : "unknown";
      return `${marker} ${index + 1}. ${session.id} (${session.messageCount} msgs, created ${createdAt})`;
    });

    return [
      "Sessions (most recent first):",
      ...lines,
      "",
      "Use /switch <number|session_id_prefix> to change sessions.",
      "Use /new to start a fresh session.",
    ].join("\n");
  }

  if (command === "switch" || command === "session") {
    if (command === "session" && (!joinedArgs || joinedArgs.toLowerCase() === "show")) {
      return context.sessionId
        ? `Current session: ${context.sessionId}`
        : "No active session in this channel context.";
    }

    const lowerArgs = joinedArgs.toLowerCase();
    if (command === "session" && (lowerArgs === "list" || lowerArgs === "ls")) {
      const allSessions = await listChannelRuntimeSessions();
      if (allSessions.length === 0) {
        return "No sessions found yet. Use /new to start a fresh session.";
      }
      const sessions = allSessions.slice(0, 20);
      const lines = sessions.map((session, index) => {
        const marker = context.sessionId === session.id ? "⭐" : "•";
        const createdAt = Number.isFinite(Date.parse(session.createdAt))
          ? new Date(session.createdAt).toLocaleString()
          : "unknown";
        return `${marker} ${index + 1}. ${session.id} (${session.messageCount} msgs, created ${createdAt})`;
      });
      return [
        "Sessions (most recent first):",
        ...lines,
        "",
        "Use /switch <number|session_id_prefix> to change sessions.",
        "Use /new to start a fresh session.",
      ].join("\n");
    }

    if (!joinedArgs) {
      return "Provide a session target. Use /switch <number|session_id_prefix>.";
    }

    if (!context.setSessionId) {
      return "Switching sessions is not supported in this channel context.";
    }

    if (lowerArgs === "new") {
      const rotated = rotateSession(context);
      if (!rotated) {
        return "Starting a fresh session is not supported in this channel context.";
      }
      return `Started a new session: ${rotated.slice(0, 8)}...`;
    }

    const sessions = await listChannelRuntimeSessions();
    const selected = resolveSessionSelection(joinedArgs, sessions);
    if (!selected.sessionId) {
      return selected.error || "Session not found.";
    }

    if (context.sessionId && context.sessionId === selected.sessionId) {
      return `Already using session: ${selected.sessionId}`;
    }

    context.setSessionId(selected.sessionId);
    const countSuffix =
      typeof selected.messageCount === "number" ? ` (${selected.messageCount} msgs)` : "";
    return `Switched to session: ${selected.sessionId}${countSuffix}`;
  }

  if (command === "status") {
    return getStatusSummary(context.channelId);
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

    if (!context.allowSecuritySettings) {
      return "Permission mode changes are only available from the local app.";
    }

    config.setToolApprovalMode(nextMode);
    return nextMode === "ask"
      ? "Tool permission mode set to ask. Dangerous tools now require explicit approval."
      : "Tool permission mode set to allow. Dangerous tools can run normally.";
  }

  if (command === "agents") {
    return formatAgentsList(getAgents(), context.channelId);
  }

  if (command === "agent") {
    const agents = getAgents();
    if (agents.length === 0) return "No agents configured yet.";

    if (!joinedArgs || joinedArgs.toLowerCase() === "show") {
      if (configuredChannelUsesModelRouter(context.channelId) && isModelRouterEnabled()) {
        return "Current channel routing: Model Router\nUse /agent <id|name|number> to select a concrete agent.";
      }
      const current = getDefaultAgent(agents, context.channelId);
      if (!current) return "No agents configured yet.";
      return [
        `Current channel agent: ${current.name}`,
        `ID: ${current.id}`,
        `Model: ${current.model || "default"}`,
        "Use /agent <id|name|number> to switch this channel.",
      ].join("\n");
    }

    if (joinedArgs.toLowerCase() === "list") {
      return formatAgentsList(agents, context.channelId);
    }

    if (joinedArgs.toLowerCase() === "router") {
      if (!setChannelModelRouter(context.channelId)) {
        return "Model Router is disabled. Enable it in Model Router settings first.";
      }
      const rotated = rotateSession(context);
      return rotated
        ? `Channel routing set to Model Router. Started a new session (${rotated.slice(0, 8)}...) so changes apply immediately.`
        : "Channel routing set to Model Router.";
    }

    const resolved = resolveByToken(joinedArgs, agents, "Agent");
    if (!resolved.item) {
      return resolved.error || "Agent not found.";
    }

    if (!setChannelAgentId(context.channelId, resolved.item.id)) {
      return "Unable to update this channel's agent.";
    }
    const rotated = rotateSession(context);

    return rotated
      ? `Channel agent set to ${resolved.item.name}. Started a new session (${rotated.slice(0, 8)}...) so changes apply immediately.`
      : `Channel agent set to ${resolved.item.name}.`;
  }

  if (command === "providers") {
    const providers = getProviders();
    const defaultAgent = getDefaultAgent(getAgents(), context.channelId);
    return formatProvidersList(providers, defaultAgent?.provider_id, defaultAgent?.name);
  }

  if (command === "provider") {
    const agents = getAgents();
    const agent = getDefaultAgent(agents, context.channelId);
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
    const agent = getDefaultAgent(agents, context.channelId);
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
    const agent = getDefaultAgent(agents, context.channelId);
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

  if (command === "workspace" || command === "cwd" || command === "dir") {
    if (!context.sessionId) {
      return "Workspace cannot be set: no active session in this context.";
    }

    if (!joinedArgs || joinedArgs.toLowerCase() === "show") {
      const current = tables.chatSessions.getWorkspace(context.sessionId);
      return current
        ? `Current workspace: ${current}`
        : "No workspace set for this session. Use /workspace <path> to set one.";
    }

    if (joinedArgs.toLowerCase() === "clear" || joinedArgs.toLowerCase() === "reset") {
      tables.chatSessions.updateWorkspace(context.sessionId, null);
      return "Workspace cleared for this session.";
    }

    let targetPath = joinedArgs;
    if (targetPath === "~") {
      targetPath = homedir();
    } else if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
      targetPath = resolve(homedir(), targetPath.slice(2));
    }
    targetPath = resolve(targetPath);

    if (!existsSync(targetPath)) {
      return `Directory not found: ${targetPath}\nMake sure the path exists and try again.`;
    }
    try {
      if (!statSync(targetPath).isDirectory()) {
        return `Not a directory: ${targetPath}\nPlease provide a directory path, not a file.`;
      }
    } catch {
      return `Cannot access: ${targetPath}`;
    }

    tables.chatSessions.updateWorkspace(context.sessionId, targetPath);
    return `Workspace set to: ${targetPath}`;
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

export function handleSharedChannelManagementCommand(
  input: string,
  context: SharedChannelCommandContext
): Promise<string | null> {
  return handleChannelManagementCommand(input, {
    ...context,
    allowSecuritySettings: false,
  });
}
