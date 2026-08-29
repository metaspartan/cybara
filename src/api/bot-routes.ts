import { listSessions, setSessionPinned } from "./chat-session-api";
import { agentManager } from "../core/agent";
import { parseAgentConfig } from "../core/agent-internals";
import { persistSession } from "../core/session-context";
import { botSessionId } from "../../shared/bot-mode";
import type { RouteHandler } from "./routes/_shared";

interface BotMetadata {
  title: string;
  description: string;
  hidden: boolean;
}

interface BotInput {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  base_agent_id?: unknown;
  hidden?: unknown;
}

const BOT_AGENT_TYPES = new Set(["main", "research", "coder", "planner", "ops"]);

function requiredAgentId(params: Record<string, string> | undefined): string {
  const value = params?.id?.trim();
  if (!value) throw new Error("Validation error: Bot id is required");
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function readBotMetadata(config: unknown): BotMetadata {
  const root = parseAgentConfig(config);
  const value = root.bot_mode;
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    title: boundedText(record.title, 80),
    description: boundedText(record.description, 240),
    hidden: record.hidden === true,
  };
}

function withBotMetadata(config: unknown, updates: Partial<BotMetadata>): Record<string, unknown> {
  const root = parseAgentConfig(config);
  return {
    ...root,
    bot_mode: {
      ...readBotMetadata(root),
      ...updates,
    },
  };
}

function serializeBot(
  agent: ReturnType<typeof agentManager.list>[number],
  session: Awaited<ReturnType<typeof listSessions>>[number] | undefined
) {
  const metadata = readBotMetadata(agent.config);
  return {
    id: agent.id,
    name: agent.name,
    title: metadata.title || agent.type || "Assistant",
    description: metadata.description,
    hidden: metadata.hidden,
    model: agent.model,
    provider: agent.provider,
    provider_id: agent.provider_id,
    status: agent.status,
    session_id: botSessionId(agent.id),
    session: session
      ? {
          title: session.title,
          updated_at: session.updatedAt,
          message_count: session.messageCount,
          last_message: session.lastMessage,
        }
      : null,
  };
}

async function botRoster() {
  const sessions = await listSessions();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return agentManager
    .list()
    .filter((agent) => BOT_AGENT_TYPES.has(agent.type || "main"))
    .map((agent) => serializeBot(agent, sessionsById.get(botSessionId(agent.id))))
    .filter((bot) => !bot.hidden)
    .sort((left, right) => {
      const leftTime = Date.parse(left.session?.updated_at || "");
      const rightTime = Date.parse(right.session?.updated_at || "");
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      return safeRight - safeLeft || left.name.localeCompare(right.name);
    });
}

async function ensureBotSession(id: string) {
  const agent = agentManager.get(id);
  if (!agent || !BOT_AGENT_TYPES.has(agent.type || "main")) {
    throw new Error("Bot not found");
  }
  const sessionId = botSessionId(id);
  const created = await persistSession(sessionId, id, [], undefined, agent.name);
  if (!created) throw new Error("Could not prepare bot conversation");
  await setSessionPinned(sessionId, true);
  return { success: true, bot_id: id, session_id: sessionId };
}

export const botRoutes: Record<string, RouteHandler> = {
  "GET /api/bots": async () => ({ bots: await botRoster() }),
  "POST /api/bots": async (body) => {
    const input = (body || {}) as BotInput;
    const name = boundedText(input.name, 80);
    if (!name) throw new Error("Validation error: Bot name is required");
    const baseId = boundedText(input.base_agent_id, 100);
    const base = baseId ? agentManager.get(baseId) : agentManager.list()[0];
    if (baseId && !base) throw new Error("Validation error: Base agent not found");
    const agent = agentManager.create({
      name,
      type: "main",
      model: base?.model,
      provider_id: base?.provider_id,
      fallback_provider_id: base?.fallback_provider_id,
      system_prompt: base?.system_prompt,
      tools: base?.tools,
      memory_enabled: true,
      config: withBotMetadata(base?.config, {
        title: boundedText(input.title, 80),
        description: boundedText(input.description, 240),
        hidden: false,
      }),
    });
    const session = await ensureBotSession(agent.id);
    return { bot: serializeBot(agentManager.get(agent.id) ?? agent, undefined), ...session };
  },
  "PUT /api/bots/:id": async (body, params) => {
    const id = requiredAgentId(params);
    const agent = agentManager.get(id);
    if (!agent || !BOT_AGENT_TYPES.has(agent.type || "main")) throw new Error("Bot not found");
    const input = (body || {}) as BotInput;
    const name = input.name === undefined ? agent.name : boundedText(input.name, 80);
    if (!name) throw new Error("Validation error: Bot name is required");
    const metadata = readBotMetadata(agent.config);
    const updated = agentManager.update(id, {
      name,
      config: withBotMetadata(agent.config, {
        title: input.title === undefined ? metadata.title : boundedText(input.title, 80),
        description:
          input.description === undefined
            ? metadata.description
            : boundedText(input.description, 240),
        hidden: input.hidden === undefined ? metadata.hidden : input.hidden === true,
      }),
    });
    if (!updated) throw new Error("Bot not found");
    return { success: true, bot: serializeBot(updated, undefined) };
  },
  "POST /api/bots/:id/session": async (_body, params) => ensureBotSession(requiredAgentId(params)),
};
