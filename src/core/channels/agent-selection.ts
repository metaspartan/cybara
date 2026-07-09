import { config } from "../config";
import { tables, type Channel } from "../database";
import { isModelRouterEnabled } from "../router";

interface SelectableAgent {
  id: string;
}

export const CHANNEL_AGENT_ID_KEY = "agent_id";
export const CHANNEL_MODEL_ROUTER_KEY = "use_model_router";

export interface ChannelAgentRouting {
  agentId?: string;
  useModelRouter: boolean;
}

export function parseChannelConfig(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeChannelAgentId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function configuredChannelAgentId(channelId?: string): string | undefined {
  if (!channelId) return undefined;
  const channel = tables.channels.get(channelId) as Channel | undefined;
  if (!channel) return undefined;
  return normalizeChannelAgentId(parseChannelConfig(channel.config)[CHANNEL_AGENT_ID_KEY]);
}

export function configuredChannelUsesModelRouter(channelId?: string): boolean {
  if (!channelId) return false;
  const channel = tables.channels.get(channelId) as Channel | undefined;
  if (!channel) return false;
  return parseChannelConfig(channel.config)[CHANNEL_MODEL_ROUTER_KEY] === true;
}

export function resolveChannelAgentId(
  channelId: string | undefined,
  agents: SelectableAgent[]
): string | undefined {
  const availableIds = new Set(agents.map((agent) => agent.id));
  const channelAgentId = configuredChannelAgentId(channelId);
  if (channelAgentId && availableIds.has(channelAgentId)) return channelAgentId;

  const defaultAgentId = normalizeChannelAgentId(config.get<string>("default_agent_id"));
  if (defaultAgentId && availableIds.has(defaultAgentId)) return defaultAgentId;

  return agents[0]?.id;
}

export function resolveChannelAgentRouting(
  channelId: string | undefined,
  agents: SelectableAgent[]
): ChannelAgentRouting {
  return {
    agentId: resolveChannelAgentId(channelId, agents),
    useModelRouter: configuredChannelUsesModelRouter(channelId) && isModelRouterEnabled(),
  };
}

export function setChannelAgentId(channelId: string, agentId?: string): boolean {
  const channel = tables.channels.get(channelId) as Channel | undefined;
  if (!channel) return false;

  const normalizedAgentId = normalizeChannelAgentId(agentId);
  if (normalizedAgentId && !tables.agents.get(normalizedAgentId)) return false;

  const nextConfig = parseChannelConfig(channel.config);
  if (normalizedAgentId) {
    nextConfig[CHANNEL_AGENT_ID_KEY] = normalizedAgentId;
  } else {
    delete nextConfig[CHANNEL_AGENT_ID_KEY];
  }
  nextConfig[CHANNEL_MODEL_ROUTER_KEY] = false;
  tables.channels.update(channelId, { config: nextConfig });
  return true;
}

export function setChannelModelRouter(channelId: string): boolean {
  const channel = tables.channels.get(channelId) as Channel | undefined;
  if (!channel || !isModelRouterEnabled()) return false;
  const nextConfig = parseChannelConfig(channel.config);
  nextConfig[CHANNEL_MODEL_ROUTER_KEY] = true;
  tables.channels.update(channelId, { config: nextConfig });
  return true;
}
