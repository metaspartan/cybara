import { deleteSession, listSessions, setSessionPinned } from "./chat-session-api";
import { agentManager } from "../core/agent";
import { parseAgentConfig } from "../core/agent-internals";
import { taskScheduler } from "../core/scheduler";
import { persistSession } from "../core/session-context";
import { botSessionId } from "../../shared/bot-mode";
import type { RouteHandler } from "./routes/_shared";

interface BotMetadata {
  title: string;
  description: string;
  hidden: boolean;
  pinned: boolean;
  baseSystemPrompt: string;
}

interface BotInput {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  base_agent_id?: unknown;
  hidden?: unknown;
  pinned?: unknown;
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
    description: boundedText(record.description, 2_000),
    hidden: record.hidden === true,
    pinned: record.pinned === true,
    baseSystemPrompt: boundedText(record.base_system_prompt, 20_000),
  };
}

function withBotMetadata(config: unknown, updates: Partial<BotMetadata>): Record<string, unknown> {
  const root = parseAgentConfig(config);
  const current = readBotMetadata(root);
  const next = { ...current, ...updates };
  return {
    ...root,
    bot_mode: {
      title: next.title,
      description: next.description,
      hidden: next.hidden,
      pinned: next.pinned,
      base_system_prompt: next.baseSystemPrompt,
    },
  };
}

function botSystemPrompt(base: string, name: string, title: string, description: string): string {
  const identity = [
    `You are ${name}, a persistent Cybara bot.`,
    title ? `Your role is ${title}.` : "",
    description ? `Your standing responsibilities and boundaries are: ${description}` : "",
    "Keep this role across conversations. Treat task-specific user messages as temporary instructions and preserve explicit approval boundaries.",
  ]
    .filter(Boolean)
    .join("\n");
  return [base.trim(), identity].filter(Boolean).join("\n\n");
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
    pinned: metadata.pinned,
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
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
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

function taskConfigText(config: unknown, key: string): string | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function duplicateBotTasks(sourceId: string, duplicateId: string): number {
  const sourceSessionId = botSessionId(sourceId);
  const duplicateSessionId = botSessionId(duplicateId);
  const sourceTasks = taskScheduler
    .list()
    .filter((task) => task.agent_id === sourceId || task.session_id === sourceSessionId);
  for (const task of sourceTasks) {
    taskScheduler.create({
      name: task.name,
      description: task.description ?? taskConfigText(task.config, "description"),
      action: task.action ?? taskConfigText(task.config, "action"),
      type: task.type,
      agent_id: duplicateId,
      session_id: task.session_id === sourceSessionId ? duplicateSessionId : undefined,
      schedule: task.schedule,
      config: task.config,
      enabled: false,
    });
  }
  return sourceTasks.length;
}

function deleteBotTasks(id: string): number {
  const sessionId = botSessionId(id);
  const ownedTasks = taskScheduler
    .list()
    .filter((task) => task.agent_id === id || task.session_id === sessionId);
  for (const task of ownedTasks) taskScheduler.delete(task.id);
  return ownedTasks.length;
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
    const title = boundedText(input.title, 80);
    const description = boundedText(input.description, 2_000);
    const baseSystemPrompt = base?.system_prompt || "";
    const agent = agentManager.create({
      name,
      type: "main",
      model: base?.model,
      provider_id: base?.provider_id,
      fallback_provider_id: base?.fallback_provider_id,
      system_prompt: botSystemPrompt(baseSystemPrompt, name, title, description),
      tools: base?.tools,
      memory_enabled: true,
      config: withBotMetadata(base?.config, {
        title,
        description,
        hidden: false,
        pinned: false,
        baseSystemPrompt,
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
    const title = input.title === undefined ? metadata.title : boundedText(input.title, 80);
    const description =
      input.description === undefined
        ? metadata.description
        : boundedText(input.description, 2_000);
    const updated = agentManager.update(id, {
      name,
      system_prompt: botSystemPrompt(
        metadata.baseSystemPrompt || agent.system_prompt || "",
        name,
        title,
        description
      ),
      config: withBotMetadata(agent.config, {
        title,
        description,
        hidden: input.hidden === undefined ? metadata.hidden : input.hidden === true,
        pinned: input.pinned === undefined ? metadata.pinned : input.pinned === true,
        baseSystemPrompt: metadata.baseSystemPrompt || agent.system_prompt || "",
      }),
    });
    if (!updated) throw new Error("Bot not found");
    return { success: true, bot: serializeBot(updated, undefined) };
  },
  "POST /api/bots/:id/duplicate": async (body, params) => {
    const sourceId = requiredAgentId(params);
    const source = agentManager.get(sourceId);
    if (!source || !BOT_AGENT_TYPES.has(source.type || "main")) throw new Error("Bot not found");
    const input = (body || {}) as BotInput;
    const metadata = readBotMetadata(source.config);
    const name = boundedText(input.name, 80) || `${source.name} copy`;
    const title = metadata.title;
    const description = metadata.description;
    const baseSystemPrompt = metadata.baseSystemPrompt || source.system_prompt || "";
    const duplicate = agentManager.create({
      name,
      type: source.type,
      model: source.model,
      provider_id: source.provider_id,
      fallback_provider_id: source.fallback_provider_id,
      system_prompt: botSystemPrompt(baseSystemPrompt, name, title, description),
      tools: source.tools,
      memory_enabled: source.memory_enabled,
      config: withBotMetadata(source.config, {
        title,
        description,
        hidden: false,
        pinned: false,
        baseSystemPrompt,
      }),
    });
    const session = await ensureBotSession(duplicate.id);
    const duplicatedTasks = duplicateBotTasks(sourceId, duplicate.id);
    return {
      bot: serializeBot(duplicate, undefined),
      duplicated_tasks: duplicatedTasks,
      ...session,
    };
  },
  "DELETE /api/bots/:id": async (_body, params) => {
    const id = requiredAgentId(params);
    const agent = agentManager.get(id);
    if (!agent || !BOT_AGENT_TYPES.has(agent.type || "main")) throw new Error("Bot not found");
    if (
      agentManager.list().filter((candidate) => BOT_AGENT_TYPES.has(candidate.type || "main"))
        .length <= 1
    ) {
      throw new Error("The last bot cannot be deleted");
    }
    const deletedTasks = deleteBotTasks(id);
    const deleted = agentManager.delete(id);
    if (!deleted) throw new Error("Could not delete bot");
    await deleteSession(botSessionId(id));
    return { success: true, bot_id: id, deleted_tasks: deletedTasks };
  },
  "POST /api/bots/:id/session": async (_body, params) => ensureBotSession(requiredAgentId(params)),
};
