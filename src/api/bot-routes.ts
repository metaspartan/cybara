import { deleteSession, listSessions, setSessionPinned } from "./chat-session-api";
import { agentManager } from "../core/agent";
import {
  buildBotSystemPrompt,
  isBotProfileConfig,
  readBotProfileMetadata,
  withBotProfileMetadata,
} from "../core/bot-profile";
import { taskScheduler } from "../core/scheduler";
import { persistSession } from "../core/session-context";
import { providerManager } from "../core/providers";
import { normalizeCapabilityAlias } from "../core/chat/capability-alias";
import { botSessionId } from "../../shared/bot-mode";
import type { RouteHandler } from "./routes/_shared";

interface BotInput {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  base_agent_id?: unknown;
  hidden?: unknown;
  pinned?: unknown;
  model?: unknown;
  provider_id?: unknown;
}

const BOT_AGENT_TYPES = new Set(["main", "research", "coder", "planner", "ops"]);
const BOT_TEAMMATE_DESCRIPTION_MAX = 320;

function requiredAgentId(params: Record<string, string> | undefined): string {
  const value = params?.id?.trim();
  if (!value) throw new Error("Validation error: Bot id is required");
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validatedProviderId(value: unknown): string {
  const providerId = boundedText(value, 100);
  if (providerId && !providerManager.get(providerId)) {
    throw new Error("Validation error: Provider not found");
  }
  return providerId;
}

function isBotAgent(agent: ReturnType<typeof agentManager.list>[number]): boolean {
  return BOT_AGENT_TYPES.has(agent.type || "main") && isBotProfileConfig(agent.config);
}

function botTeammates(
  excludedId: string,
  bots: ReturnType<typeof agentManager.list> = agentManager.list().filter(isBotAgent)
): string {
  const teammates = bots
    .filter((agent) => agent.id !== excludedId)
    .map((agent) => {
      const metadata = readBotProfileMetadata(agent.config);
      const description = metadata.description.slice(0, BOT_TEAMMATE_DESCRIPTION_MAX);
      const role = [metadata.title, description].filter(Boolean).join(": ");
      return `- @${normalizeCapabilityAlias(agent.name)} — ${agent.name} (agentId: ${agent.id})${role ? ` — ${role}` : ""}`;
    });
  if (teammates.length === 0) return "You currently have no other bot teammates.";
  return [
    "Your bot teammates are listed below. When delegation is useful, use sessions_spawn with the teammate's agentId and maxToolIterations 12, preserve the user's exact scope and limits in the child task, wait with sessions_wait, and incorporate the result.",
    ...teammates,
  ].join("\n");
}

function refreshBotSystemPrompts(): void {
  const bots = agentManager.list().filter(isBotAgent);
  for (const agent of bots) {
    const metadata = readBotProfileMetadata(agent.config);
    agentManager.update(agent.id, {
      system_prompt: buildBotSystemPrompt(
        metadata.baseSystemPrompt,
        agent.name,
        metadata.title,
        metadata.description,
        botTeammates(agent.id, bots)
      ),
    });
  }
}

function serializeBot(
  agent: ReturnType<typeof agentManager.list>[number],
  session: Awaited<ReturnType<typeof listSessions>>[number] | undefined
) {
  const metadata = readBotProfileMetadata(agent.config);
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
    .filter(isBotAgent)
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
  if (!agent || !isBotAgent(agent)) {
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
    const base = baseId
      ? agentManager.get(baseId)
      : (agentManager.list().find((agent) => !isBotProfileConfig(agent.config)) ??
        agentManager.list()[0]);
    if (baseId && !base) throw new Error("Validation error: Base agent not found");
    const title = boundedText(input.title, 80);
    const description = boundedText(input.description, 2_000);
    const model = boundedText(input.model, 200) || base?.model;
    const providerId = validatedProviderId(input.provider_id) || base?.provider_id;
    const baseSystemPrompt = base
      ? isBotAgent(base)
        ? readBotProfileMetadata(base.config).baseSystemPrompt
        : base.system_prompt || ""
      : "";
    const agent = agentManager.create({
      name,
      type: "main",
      model,
      provider_id: providerId,
      fallback_provider_id: base?.fallback_provider_id,
      system_prompt: buildBotSystemPrompt(baseSystemPrompt, name, title, description, ""),
      tools: base?.tools,
      memory_enabled: true,
      config: withBotProfileMetadata(base?.config, {
        title,
        description,
        hidden: false,
        pinned: false,
        baseSystemPrompt,
      }),
    });
    refreshBotSystemPrompts();
    const session = await ensureBotSession(agent.id);
    return { bot: serializeBot(agentManager.get(agent.id) ?? agent, undefined), ...session };
  },
  "PUT /api/bots/:id": async (body, params) => {
    const id = requiredAgentId(params);
    const agent = agentManager.get(id);
    if (!agent || !isBotAgent(agent)) throw new Error("Bot not found");
    const input = (body || {}) as BotInput;
    const name = input.name === undefined ? agent.name : boundedText(input.name, 80);
    if (!name) throw new Error("Validation error: Bot name is required");
    const metadata = readBotProfileMetadata(agent.config);
    const title = input.title === undefined ? metadata.title : boundedText(input.title, 80);
    const description =
      input.description === undefined
        ? metadata.description
        : boundedText(input.description, 2_000);
    const updated = agentManager.update(id, {
      name,
      model: input.model === undefined ? agent.model : boundedText(input.model, 200),
      provider_id:
        input.provider_id === undefined
          ? agent.provider_id
          : validatedProviderId(input.provider_id),
      system_prompt: buildBotSystemPrompt(
        metadata.baseSystemPrompt,
        name,
        title,
        description,
        botTeammates(id)
      ),
      config: withBotProfileMetadata(agent.config, {
        title,
        description,
        hidden: input.hidden === undefined ? metadata.hidden : input.hidden === true,
        pinned: input.pinned === undefined ? metadata.pinned : input.pinned === true,
        baseSystemPrompt: metadata.baseSystemPrompt,
      }),
    });
    if (!updated) throw new Error("Bot not found");
    const rosterChanged =
      name !== agent.name || title !== metadata.title || description !== metadata.description;
    if (rosterChanged) refreshBotSystemPrompts();
    return { success: true, bot: serializeBot(updated, undefined) };
  },
  "POST /api/bots/:id/duplicate": async (body, params) => {
    const sourceId = requiredAgentId(params);
    const source = agentManager.get(sourceId);
    if (!source || !isBotAgent(source)) throw new Error("Bot not found");
    const input = (body || {}) as BotInput;
    const metadata = readBotProfileMetadata(source.config);
    const name = boundedText(input.name, 80) || `${source.name} copy`;
    const title = metadata.title;
    const description = metadata.description;
    const baseSystemPrompt = metadata.baseSystemPrompt;
    const duplicate = agentManager.create({
      name,
      type: source.type,
      model: source.model,
      provider_id: source.provider_id,
      fallback_provider_id: source.fallback_provider_id,
      system_prompt: buildBotSystemPrompt(baseSystemPrompt, name, title, description, ""),
      tools: source.tools,
      memory_enabled: source.memory_enabled,
      config: withBotProfileMetadata(source.config, {
        title,
        description,
        hidden: false,
        pinned: false,
        baseSystemPrompt,
      }),
    });
    refreshBotSystemPrompts();
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
    if (!agent || !isBotAgent(agent)) throw new Error("Bot not found");
    const deletedTasks = deleteBotTasks(id);
    const deleted = agentManager.delete(id);
    if (!deleted) throw new Error("Could not delete bot");
    await deleteSession(botSessionId(id));
    refreshBotSystemPrompts();
    return { success: true, bot_id: id, deleted_tasks: deletedTasks };
  },
  "POST /api/bots/:id/session": async (_body, params) => ensureBotSession(requiredAgentId(params)),
};
