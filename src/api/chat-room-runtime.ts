import { type AgentExecutionResult, type AgentMessage, agentManager } from "../core/agent";
import { agentSupportsImages } from "../core/agent-image-capabilities";
import { normalizeChatImageAttachments, persistImageAttachments } from "../core/chat/attachments";
import { uniqueCapabilityHandles } from "../core/chat/capability-handles";
import { normalizeCapabilityAlias } from "../core/chat/capability-alias";
import type { Agent } from "../core/database";
import { hasImages } from "../core/llm/image-blocks";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { createLogger } from "../core/logger";
import { logAgentActivity, logSessionMessage } from "../core/logging";
import { trackSessionEvent } from "../core/metrics";
import {
  estimateSessionContextUsage,
  loadPersistedSession,
  loadSessionRoomConfig,
  normalizeSessionWorkspaceDir,
  persistSession,
  persistSessionRoomConfig,
  resolveSessionModelMetadata,
  summarizeSessionTokenUsage,
  upsertPersistedSessionMessage,
} from "../core/session-context";
import {
  getActiveSessionRunId,
  getActiveSessionRunStartedAtMs,
} from "../core/session-event-ledger";
import { broadcastSessionMessageEvent, broadcastStatus } from "../core/status";
import { resolveAgentToolPolicy } from "../core/toolsets";
import {
  isRoomPassReply,
  isRoomSessionId,
  normalizeRoomConfig,
  ROOM_PASS_TOKEN,
  type RoomConfig,
  roomSessionId,
} from "../../shared/room-mode";
import { stripAgentAttributionTag } from "./chat-agent-handoff";
import { activeAgentSystemPrompt } from "./chat-agent-prompt";
import { buildChatExecutionMessagesForAgent } from "./chat-execution-messages";
import { executionMetadataFromResult } from "./chat-execution-metadata";
import { sanitizeProcessThoughtText, stripThinkingTags } from "./chat-formatting";
import { appendAssistantMessage } from "./chat-pending-state";
import { buildFallbackProcessActivities, type ToolCallInfo } from "./chat-process-activities";
import { normalizeAgentExecutionFailure } from "./chat-provider-failure";
import {
  activeChatTurnAbortControllers,
  buildLastMessagePreview,
  cacheChatSession,
  chatTurnMutex,
  countVisibleSessionMessages,
  getResidentChatSession,
  type InMemoryChatSession,
  parseIsoTimestampMs,
  persistChatSessionSnapshot,
  restorePersistedChatSessionForChat,
  upsertPersistedSessionIndex,
} from "./chat-runtime-state";
import { isChatTurnInterrupted } from "./chat-runtime-stability";
import {
  collectAttachedProcessActivityIds,
  getSessionProcessActivities,
} from "./chat-steering-activities";
import { buildNoUsableAssistantResponseMessage, toToolCallInfo } from "./chat-tool-summary";
import type { ChatMessage, ChatRequest, ChatResponse } from "./chat-types";

const log = createLogger("ChatRoom");

const ROOM_TRANSCRIPT_TAIL_FOR_MODERATOR = 14;
const ROOM_MODERATOR_MAX_DECISION_CHARS = 4000;
const MODERATOR_UNDECIDED_LIMIT = 2;

export interface RoomParticipant {
  agent: Agent;
  handle: string;
}

export interface RoomTurnReply {
  participant: RoomParticipant;
  message: ChatMessage;
  passed: boolean;
}

interface RoomSpeakOptions {
  round: number;
  allowPass: boolean;
  history?: ChatMessage[];
  attachActivities?: boolean;
}

interface RoomTurnContext {
  session: InMemoryChatSession;
  config: RoomConfig;
  participants: RoomParticipant[];
  request: ChatRequest;
  abortController: AbortController;
  toolsEnabled: boolean;
  supportsImagesByAgent: Map<string, boolean>;
}

function participantLabel(participant: RoomParticipant): string {
  const model = participant.agent.model?.trim();
  return model ? `${participant.agent.name} (${model})` : participant.agent.name;
}

export function resolveRoomParticipants(config: RoomConfig): RoomParticipant[] {
  const agents = config.participantAgentIds
    .map((id) => agentManager.get(id))
    .filter((agent): agent is Agent => !!agent);
  const handles = uniqueCapabilityHandles(agents);
  return agents.map((agent) => ({
    agent,
    handle: handles.get(agent.id) ?? normalizeCapabilityAlias(agent.name) ?? agent.id,
  }));
}

function participantAliases(participant: RoomParticipant): string[] {
  return [
    participant.handle.toLowerCase(),
    normalizeCapabilityAlias(participant.agent.name),
    participant.agent.id.toLowerCase(),
  ].filter(Boolean);
}

export function findRoomParticipantByAlias(
  alias: string,
  participants: readonly RoomParticipant[]
): RoomParticipant | undefined {
  const normalized = normalizeCapabilityAlias(alias);
  if (!normalized) return undefined;
  return participants.find((participant) => participantAliases(participant).includes(normalized));
}

export function parseRoomMentions(
  text: string,
  participants: readonly RoomParticipant[]
): RoomParticipant[] {
  const mentioned: RoomParticipant[] = [];
  const seen = new Set<string>();
  const pattern = /(^|[^\w@])@([a-z0-9][a-z0-9._-]*)/gi;
  for (const match of text.matchAll(pattern)) {
    const participant = findRoomParticipantByAlias(match[2], participants);
    if (!participant || seen.has(participant.agent.id)) continue;
    seen.add(participant.agent.id);
    mentioned.push(participant);
  }
  return mentioned;
}

export function buildRoomInstruction(input: {
  self: RoomParticipant;
  participants: readonly RoomParticipant[];
  config: RoomConfig;
  round: number;
  allowPass: boolean;
}): string {
  const { self, participants, config, round, allowPass } = input;
  const others = participants.filter((participant) => participant.agent.id !== self.agent.id);
  const roster =
    others.length > 0
      ? others.map((participant) => `@${participant.handle} = ${participantLabel(participant)}`)
      : ["(no other participants yet)"];
  const modeLine: Record<RoomConfig["mode"], string> = {
    round_robin:
      "Discussion mode: round robin. Every participant replies in order each round; later rounds continue only while someone still has something to add.",
    mention_only:
      "Discussion mode: mention only. Only participants who are @mentioned reply. Mention a teammate by handle when you want them to weigh in.",
    parallel:
      "Discussion mode: parallel. Every participant answers this round at the same time without seeing the others' replies for this round.",
    moderated:
      "Discussion mode: moderated. A moderator decides who speaks next and when the discussion ends.",
  };
  const lines = [
    `You are ${self.agent.name} (@${self.handle}), one of ${participants.length} agents in a shared group room with the user.`,
    "Everyone in the room sees every message. Messages from the user are prefixed [User]; messages from other agents are prefixed with their name in square brackets. Your own earlier replies appear unprefixed as assistant turns.",
    `Other participants: ${roster.join("; ")}.`,
    modeLine[config.mode],
    `This is round ${round} of at most ${config.maxRounds} for the current user message.`,
    "Speak as yourself in your own voice. Do not answer on behalf of other agents, do not restate what a teammate already said, and do not prefix your reply with your name.",
    "Address teammates with @handle when you disagree, want a second opinion, or hand a sub-task over.",
    allowPass
      ? `If you have nothing new to add this round, reply with exactly ${ROOM_PASS_TOKEN} and nothing else.`
      : "Give a substantive reply this round.",
  ];
  if (config.sharedContext) {
    lines.push(`Shared room context: ${config.sharedContext}`);
  }
  return lines.join("\n");
}

function otherAgentAuthor(message: ChatMessage, selfAgentId: string): string | null {
  if (message.role !== "assistant") return null;
  const agentId = message.agent_id?.trim();
  if (!agentId || agentId === selfAgentId) return null;
  return message.agent_name?.trim() || agentId;
}

export function projectRoomTranscriptForAgent(
  messages: readonly ChatMessage[],
  selfAgentId: string,
  systemPrompt: string,
  turnCue: string
): ChatMessage[] {
  const projected: ChatMessage[] = [];
  const pushUserBlock = (message: ChatMessage): void => {
    const previous = projected[projected.length - 1];
    if (
      previous &&
      previous.role === "user" &&
      !previous.images?.length &&
      !message.images?.length
    ) {
      previous.content = `${previous.content}\n\n${message.content}`;
      if (message.image_context) {
        previous.image_context = [previous.image_context, message.image_context]
          .filter(Boolean)
          .join("\n\n");
      }
      return;
    }
    projected.push(message);
  };
  messages.forEach((message, index) => {
    if (index === 0 && message.role === "system") {
      projected.push({ ...message, content: systemPrompt });
      return;
    }
    if (message.role === "system") {
      projected.push(message);
      return;
    }
    const author = otherAgentAuthor(message, selfAgentId);
    if (author) {
      const content = stripAgentAttributionTag(message.content).trim();
      if (!content) return;
      pushUserBlock({
        role: "user",
        content: `[${author}]: ${content}`,
        timestamp: message.timestamp,
      });
      return;
    }
    if (message.role === "user") {
      pushUserBlock({ ...message, content: `[User]: ${message.content}` });
      return;
    }
    projected.push(message);
  });
  pushUserBlock({ role: "user", content: turnCue, timestamp: new Date().toISOString() });
  return projected;
}

async function buildRoomExecutionMessages(
  context: RoomTurnContext,
  participant: RoomParticipant,
  history: ChatMessage[],
  options: RoomSpeakOptions
): Promise<AgentMessage[]> {
  const { session, config, participants, toolsEnabled, request } = context;
  const systemPrompt = await activeAgentSystemPrompt(
    participant.agent,
    session.workspaceDir ?? undefined,
    history,
    { useTools: toolsEnabled, runtimeChannel: request.channel }
  );
  const turnCue = `[Room]: It is your turn, ${participant.agent.name}. Reply now${
    options.allowPass ? ` or say ${ROOM_PASS_TOKEN}` : ""
  }.`;
  const projected = projectRoomTranscriptForAgent(
    history,
    participant.agent.id,
    systemPrompt,
    turnCue
  );
  const executionMessages = buildChatExecutionMessagesForAgent(projected, {
    sessionId: session.id,
    supportsImages: context.supportsImagesByAgent.get(participant.agent.id) !== false,
    activeAgentId: participant.agent.id,
  });
  const instruction: AgentMessage = {
    role: "system",
    content: buildRoomInstruction({
      self: participant,
      participants,
      config,
      round: options.round,
      allowPass: options.allowPass,
    }),
  };
  if (executionMessages[0]?.role === "system") executionMessages.splice(1, 0, instruction);
  else executionMessages.unshift(instruction);
  return executionMessages;
}

function toToolCallInfos(result: AgentExecutionResult): ToolCallInfo[] {
  return (result.tool_calls || []).map((toolCall, index) => toToolCallInfo(toolCall, index));
}

async function speakInRoomTurn(
  context: RoomTurnContext,
  participant: RoomParticipant,
  options: RoomSpeakOptions
): Promise<RoomTurnReply | null> {
  const { session, request, abortController, toolsEnabled } = context;
  const agent = participant.agent;
  const history = options.history ?? session.messages;
  const startedAtMs = Date.now();
  broadcastStatus({
    status: "thinking",
    timestamp: startedAtMs,
    detail: `${agent.name} is thinking...`,
    sessionId: session.id,
    agentId: agent.id,
  });
  const executionMessages = await buildRoomExecutionMessages(
    context,
    participant,
    history,
    options
  );
  const allowedToolNames = toolsEnabled
    ? resolveAgentToolPolicy(agent).allowedToolNames
    : undefined;
  let result: AgentExecutionResult;
  try {
    result = await agentManager.execute(agent.id, executionMessages, {
      sessionId: session.id,
      workspaceDir: session.workspaceDir || undefined,
      abortSignal: abortController.signal,
      useTools: toolsEnabled,
      allowedToolNames,
      useModelRouter: session.useModelRouter,
      maxOutputTokens: request.maxOutputTokens,
      modelParamsOverride: request.modelParamsOverride,
    });
  } catch (error) {
    if (isChatTurnInterrupted(error, abortController.signal)) throw error;
    const normalized = normalizeAgentExecutionFailure(error);
    log.error("Room participant failed", { sessionId: session.id, agentId: agent.id, error });
    result = {
      content:
        normalized.content ||
        `${agent.name} could not respond: ${(error as Error).message || "provider error"}`,
      failure: normalized.failure,
    };
  }
  const toolCalls = toToolCallInfos(result);
  const { content: extractedContent, thinking: extractedThinking } = stripThinkingTags(
    result.content || ""
  );
  const cleanContent = stripAgentAttributionTag(sanitizeAssistantContent(extractedContent)).trim();
  const passed = options.allowPass && isRoomPassReply(cleanContent) && toolCalls.length === 0;
  if (passed) {
    log.debug("Room participant passed", { sessionId: session.id, agentId: agent.id });
    return null;
  }
  const thinking = sanitizeProcessThoughtText(result.thinking || extractedThinking || "");
  const timestamp = new Date().toISOString();
  const timestampMs = parseIsoTimestampMs(timestamp) || Date.now();
  const snapshotActivities =
    options.attachActivities === false
      ? undefined
      : getSessionProcessActivities(session.id, {
          excludeActivityIds: collectAttachedProcessActivityIds(session.messages),
        });
  const processActivities =
    snapshotActivities && snapshotActivities.length > 0
      ? snapshotActivities
      : buildFallbackProcessActivities(toolCalls, thinking || undefined, startedAtMs);
  const modelMetadata = {
    ...(resolveSessionModelMetadata(agent.id) ?? {}),
    ...(executionMetadataFromResult(result) ?? {}),
  };
  const message: ChatMessage = {
    role: "assistant",
    content: cleanContent || buildNoUsableAssistantResponseMessage(),
    timestamp,
    ...modelMetadata,
    thinking: thinking || undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    process_activities: processActivities,
    run_id: getActiveSessionRunId(session.id),
    worked_duration_ms: Math.max(
      0,
      timestampMs - (getActiveSessionRunStartedAtMs(session.id) ?? startedAtMs)
    ),
    interrupted: result.failure?.retryable === true || undefined,
  };
  appendAssistantMessage(session, message);
  await logSessionMessage(session.id, "assistant", message.content, {
    agentId: agent.id,
    createdAt: message.timestamp,
    metadata: {
      source: "chat_room",
      ...modelMetadata,
      thinking: message.thinking,
      tool_calls: toolCalls,
      process_activities: message.process_activities,
      run_id: message.run_id,
      worked_duration_ms: message.worked_duration_ms,
      interrupted: message.interrupted,
      room_round: options.round,
    },
  });
  session.persisted = await persistChatSessionSnapshot(session, message);
  broadcastSessionMessageEvent({
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    role: "assistant",
  });
  await logAgentActivity(agent.id, "chat_response", `Replied in room ${session.id.slice(0, 13)}`, {
    sessionId: session.id,
    messageLength: message.content.length,
    toolsUsed: toolCalls.length,
  });
  return { participant, message, passed: false };
}

function ensureNotAborted(controller: AbortController): void {
  if (controller.signal.aborted) {
    throw new DOMException("Room discussion stopped", "AbortError");
  }
}

function transcriptTailForModerator(messages: readonly ChatMessage[]): string {
  const visible = messages.filter((message) => message.role !== "system");
  const tail = visible.slice(-ROOM_TRANSCRIPT_TAIL_FOR_MODERATOR);
  return tail
    .map((message) => {
      const author =
        message.role === "user"
          ? "User"
          : message.agent_name?.trim() || message.agent_id || "Agent";
      return `[${author}]: ${message.content.slice(0, 1200)}`;
    })
    .join("\n\n")
    .slice(-ROOM_MODERATOR_MAX_DECISION_CHARS);
}

const MODERATOR_END_ALIASES = new Set(["none", "end", "stop", "done", "finish", "nobody"]);

export interface ModeratorDecision {
  next: RoomParticipant | null;
  note: string;
  end: boolean;
}

export function parseModeratorDecision(
  raw: string,
  participants: readonly RoomParticipant[]
): ModeratorDecision {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let next: unknown;
  let note = "";
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { next?: unknown; note?: unknown };
      next = parsed.next;
      note = typeof parsed.note === "string" ? parsed.note.trim() : "";
    } catch {
      next = undefined;
    }
  }
  if (typeof next === "string") {
    const alias = normalizeCapabilityAlias(next);
    if (MODERATOR_END_ALIASES.has(alias)) return { next: null, note, end: true };
    const participant = findRoomParticipantByAlias(alias, participants);
    if (participant) return { next: participant, note, end: false };
  }
  const mentioned = parseRoomMentions(raw, participants)[0];
  if (mentioned) return { next: mentioned, note, end: false };
  return { next: null, note, end: false };
}

async function askModerator(
  context: RoomTurnContext,
  moderator: Agent,
  spokenCount: number,
  budget: number
): Promise<{ next: RoomParticipant | null; note: string; end: boolean }> {
  const { session, participants, abortController } = context;
  broadcastStatus({
    status: "thinking",
    timestamp: Date.now(),
    detail: `${moderator.name} is choosing the next speaker...`,
    sessionId: session.id,
    agentId: moderator.id,
  });
  const roster = participants
    .map((participant) => `@${participant.handle} = ${participantLabel(participant)}`)
    .join("; ");
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: [
        `You are ${moderator.name}, moderating a group discussion between the user and these agents: ${roster}.`,
        `${spokenCount} agent replies have been made for the current user message; at most ${budget} more are allowed.`,
        "Pick the single participant whose input is most valuable next, or end the discussion when the user's request has been answered well enough or the agents are repeating themselves.",
        'Respond with JSON only: {"next":"<handle or none>","note":"<one short sentence>"}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: `Transcript so far:\n\n${transcriptTailForModerator(session.messages)}`,
    },
  ];
  try {
    const result = await agentManager.execute(moderator.id, messages, {
      useTools: false,
      useMemory: false,
      abortSignal: abortController.signal,
      maxOutputTokens: 200,
    });
    return parseModeratorDecision(result.content || "", participants);
  } catch (error) {
    if (isChatTurnInterrupted(error, abortController.signal)) throw error;
    log.warn("Room moderator failed; ending discussion", {
      sessionId: session.id,
      error: (error as Error).message,
    });
    return { next: null, note: "", end: true };
  }
}

async function runRoomDiscussion(
  context: RoomTurnContext,
  userMessage: ChatMessage
): Promise<RoomTurnReply[]> {
  const { config, participants, abortController } = context;
  const replies: RoomTurnReply[] = [];
  const record = (reply: RoomTurnReply | null): boolean => {
    if (!reply) return false;
    replies.push(reply);
    return true;
  };

  if (config.mode === "parallel") {
    for (let round = 1; round <= config.maxRounds; round += 1) {
      ensureNotAborted(abortController);
      const history = [...context.session.messages];
      const settled = await Promise.all(
        participants.map((participant) =>
          speakInRoomTurn(context, participant, {
            round,
            allowPass: round > 1,
            history,
            attachActivities: false,
          })
        )
      );
      let anySpoke = false;
      for (const reply of settled) anySpoke = record(reply) || anySpoke;
      if (!anySpoke) break;
    }
    return replies;
  }

  if (config.mode === "mention_only") {
    let targets = parseRoomMentions(userMessage.content, participants);
    if (targets.length === 0) targets = [...participants];
    for (let round = 1; round <= config.maxRounds && targets.length > 0; round += 1) {
      const nextTargets = new Map<string, RoomParticipant>();
      for (const participant of targets) {
        ensureNotAborted(abortController);
        const reply = await speakInRoomTurn(context, participant, {
          round,
          allowPass: round > 1,
        });
        if (!record(reply) || !reply) continue;
        for (const mentioned of parseRoomMentions(reply.message.content, participants)) {
          if (mentioned.agent.id !== participant.agent.id) {
            nextTargets.set(mentioned.agent.id, mentioned);
          }
        }
      }
      targets = [...nextTargets.values()];
    }
    return replies;
  }

  if (config.mode === "moderated") {
    const moderator =
      (config.moderatorAgentId ? agentManager.get(config.moderatorAgentId) : undefined) ??
      participants[0]?.agent;
    if (!moderator) return replies;
    let budget = config.maxRounds * participants.length;
    let undecided = 0;
    while (budget > 0) {
      ensureNotAborted(abortController);
      const decision = await askModerator(context, moderator, replies.length, budget);
      if (decision.end) break;
      if (!decision.next) {
        undecided += 1;
        if (undecided >= MODERATOR_UNDECIDED_LIMIT) break;
        budget -= 1;
        continue;
      }
      undecided = 0;
      const round = Math.floor(replies.length / participants.length) + 1;
      record(
        await speakInRoomTurn(context, decision.next, {
          round,
          allowPass: replies.length > 0,
        })
      );
      budget -= 1;
    }
    return replies;
  }

  for (let round = 1; round <= config.maxRounds; round += 1) {
    let anySpoke = false;
    for (const participant of participants) {
      ensureNotAborted(abortController);
      anySpoke =
        record(await speakInRoomTurn(context, participant, { round, allowPass: round > 1 })) ||
        anySpoke;
    }
    if (!anySpoke) break;
  }
  return replies;
}

async function loadRoomSession(sessionId: string): Promise<InMemoryChatSession | undefined> {
  const resident = getResidentChatSession(sessionId);
  if (resident) return resident;
  const restored = await restorePersistedChatSessionForChat(sessionId);
  if (restored) return restored;
  const persisted = await loadPersistedSession(sessionId);
  if (!persisted) return undefined;
  const nowIso = new Date().toISOString();
  const session: InMemoryChatSession = {
    id: sessionId,
    agentId: persisted.agentId,
    useModelRouter: persisted.useModelRouter,
    title: persisted.title,
    messages: [{ role: "system", content: "Group room session.", timestamp: nowIso }],
    createdAt: nowIso,
    updatedAt: nowIso,
    workspaceDir: persisted.workspaceDir,
    persisted: true,
    room: persisted.roomConfig,
  };
  cacheChatSession(session);
  return session;
}

function roomFailureResponse(sessionId: string, content: string): ChatResponse {
  return {
    sessionId,
    message: { role: "assistant", content, timestamp: new Date().toISOString() },
  };
}

async function prepareRoomTurnContext(
  request: ChatRequest,
  sessionId: string
): Promise<{ context: RoomTurnContext } | { error: ChatResponse }> {
  const session = await loadRoomSession(sessionId);
  const config = session?.room ?? loadSessionRoomConfig(sessionId);
  if (!session || !config) {
    return { error: roomFailureResponse(sessionId, "This group room no longer exists.") };
  }
  session.room = config;
  const participants = resolveRoomParticipants(config);
  if (participants.length === 0) {
    return {
      error: roomFailureResponse(
        sessionId,
        "None of the room participants are available. Add agents to the room and try again."
      ),
    };
  }
  if (!config.participantAgentIds.includes(session.agentId)) {
    session.agentId = participants[0].agent.id;
  }
  if (request.workspaceDir !== undefined) {
    session.workspaceDir = normalizeSessionWorkspaceDir(request.workspaceDir);
  }
  const abortController = new AbortController();
  if (request.abortSignal) {
    if (request.abortSignal.aborted) abortController.abort(request.abortSignal.reason);
    else {
      request.abortSignal.addEventListener(
        "abort",
        () => abortController.abort(request.abortSignal?.reason),
        { once: true }
      );
    }
  }
  const supportsImagesByAgent = new Map(
    participants.map((participant) => [
      participant.agent.id,
      agentSupportsImages(participant.agent),
    ])
  );
  return {
    context: {
      session,
      config,
      participants,
      request,
      abortController,
      toolsEnabled: request.tools !== false,
      supportsImagesByAgent,
    },
  };
}

function finishRoomResponse(context: RoomTurnContext, replies: RoomTurnReply[]): ChatResponse {
  const { session } = context;
  const aborted = context.abortController.signal.aborted;
  const last = replies[replies.length - 1];
  const stoppedMarker = aborted
    ? session.messages.findLast((entry) => entry.role === "assistant" && entry.interrupted === true)
    : undefined;
  const message: ChatMessage = last?.message ??
    stoppedMarker ?? {
      role: "assistant",
      content: aborted ? "" : "No participant replied this round.",
      timestamp: new Date().toISOString(),
    };
  return {
    sessionId: session.id,
    session_agent_id: session.agentId,
    workspaceDir: session.workspaceDir ?? null,
    message,
    messages: replies.map((reply) => reply.message),
    contextUsage: estimateSessionContextUsage(session.messages, undefined, {
      sessionId: session.id,
      compactionCount: session.compactionCount || 0,
    }),
    tokenUsage: summarizeSessionTokenUsage(session.id),
    agent: last ? { id: last.participant.agent.id, name: last.participant.agent.name } : undefined,
    interrupted: aborted || undefined,
    stopped: aborted || undefined,
  };
}

async function runRoomTurn(
  context: RoomTurnContext,
  discussion: () => Promise<RoomTurnReply[]>
): Promise<ChatResponse> {
  const { session, abortController } = context;
  activeChatTurnAbortControllers.set(session.id, abortController);
  let replies: RoomTurnReply[] = [];
  try {
    replies = await discussion();
  } catch (error) {
    if (!isChatTurnInterrupted(error, abortController.signal)) {
      log.error("Room turn failed", { sessionId: session.id, error: (error as Error).message });
      replies = [];
    }
  } finally {
    if (activeChatTurnAbortControllers.get(session.id) === abortController) {
      activeChatTurnAbortControllers.delete(session.id);
    }
    upsertPersistedSessionIndex({
      id: session.id,
      agentId: session.agentId,
      useModelRouter: session.useModelRouter,
      title: session.title,
      messageCount: countVisibleSessionMessages(session.messages),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      workspaceDir: session.workspaceDir ?? null,
      lastMessage: buildLastMessagePreview(session.messages[session.messages.length - 1]),
      room: session.room ?? null,
    });
    broadcastStatus({
      status: "idle",
      timestamp: Date.now(),
      detail: "Idle",
      sessionId: session.id,
      agentId: session.agentId,
    });
  }
  return finishRoomResponse(context, replies);
}

export async function handleRoomChatTurn(
  request: ChatRequest,
  sessionId: string
): Promise<ChatResponse> {
  const prepared = await prepareRoomTurnContext(request, sessionId);
  if ("error" in prepared) return prepared.error;
  const { context } = prepared;
  const { session } = context;
  const sanitizedImages = await normalizeChatImageAttachments(request.images);
  const userMessage: ChatMessage = {
    role: "user",
    content: request.message,
    timestamp: new Date().toISOString(),
    ...(hasImages(sanitizedImages) ? { images: sanitizedImages } : {}),
  };
  session.messages.push(userMessage);
  session.updatedAt = userMessage.timestamp || new Date().toISOString();
  const attachments = hasImages(sanitizedImages)
    ? persistImageAttachments(session.id, sanitizedImages)
    : [];
  await upsertPersistedSessionMessage(session.id, session.agentId, userMessage, {
    stableKey: `chat-user:${userMessage.timestamp || session.id}`,
    metadata: {
      source: "chat_room",
      ...(attachments.length ? { attachments } : {}),
    },
  });
  session.persisted = await persistChatSessionSnapshot(session, userMessage);
  broadcastStatus({
    status: "thinking",
    timestamp: Date.now(),
    detail: "Opening the room discussion...",
    sessionId: session.id,
    agentId: session.agentId,
  });
  return runRoomTurn(context, () => runRoomDiscussion(context, userMessage));
}

export async function speakInRoom(sessionId: string, agentId: string): Promise<ChatResponse> {
  if (!isRoomSessionId(sessionId)) {
    throw new Error("Validation error: Session is not a group room");
  }
  return chatTurnMutex.run(sessionId, async () => {
    const prepared = await prepareRoomTurnContext({ message: "" }, sessionId);
    if ("error" in prepared) return prepared.error;
    const { context } = prepared;
    const participant = context.participants.find((entry) => entry.agent.id === agentId.trim());
    if (!participant) {
      throw new Error("Validation error: Agent is not a participant in this room");
    }
    return runRoomTurn(context, async () => {
      const reply = await speakInRoomTurn(context, participant, { round: 1, allowPass: false });
      return reply ? [reply] : [];
    });
  });
}

export interface CreateRoomInput {
  participantAgentIds: string[];
  mode?: RoomConfig["mode"];
  maxRounds?: number;
  moderatorAgentId?: string | null;
  sharedContext?: string;
  title?: string;
  workspaceDir?: string | null;
}

export interface RoomSessionSummary {
  sessionId: string;
  title: string;
  config: RoomConfig;
  participants: Array<{ id: string; name: string; handle: string; model?: string }>;
}

function validateRoomConfig(value: unknown): RoomConfig {
  const config = normalizeRoomConfig(value);
  if (!config) throw new Error("Validation error: at least one participant agent is required");
  const missing = config.participantAgentIds.filter((id) => !agentManager.get(id));
  if (missing.length > 0) {
    throw new Error(`Validation error: unknown agent(s): ${missing.join(", ")}`);
  }
  if (config.moderatorAgentId && !agentManager.get(config.moderatorAgentId)) {
    throw new Error("Validation error: moderator agent not found");
  }
  return config;
}

export function summarizeRoom(
  sessionId: string,
  title: string,
  config: RoomConfig
): RoomSessionSummary {
  return {
    sessionId,
    title,
    config,
    participants: resolveRoomParticipants(config).map((participant) => ({
      id: participant.agent.id,
      name: participant.agent.name,
      handle: participant.handle,
      model: participant.agent.model,
    })),
  };
}

export async function createRoomSession(input: CreateRoomInput): Promise<RoomSessionSummary> {
  const config = validateRoomConfig(input);
  const participants = resolveRoomParticipants(config);
  const sessionId = roomSessionId();
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 120)
      : `Room: ${participants.map((participant) => participant.agent.name).join(", ")}`;
  const workspaceDir =
    input.workspaceDir !== undefined ? normalizeSessionWorkspaceDir(input.workspaceDir) : null;
  const primaryAgentId = participants[0].agent.id;
  const created = await persistSession(sessionId, primaryAgentId, [], workspaceDir, title);
  if (!created) throw new Error("Could not create room session");
  persistSessionRoomConfig(sessionId, primaryAgentId, config);
  const nowIso = new Date().toISOString();
  upsertPersistedSessionIndex({
    id: sessionId,
    agentId: primaryAgentId,
    useModelRouter: false,
    title,
    messageCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    workspaceDir,
    lastMessage: null,
    room: config,
  });
  trackSessionEvent(sessionId, "created", {
    kind: "room",
    mode: config.mode,
    participants: config.participantAgentIds.length,
  });
  return summarizeRoom(sessionId, title, config);
}

export async function getRoomSummary(sessionId: string): Promise<RoomSessionSummary | null> {
  if (!isRoomSessionId(sessionId)) return null;
  const resident = getResidentChatSession(sessionId);
  const config = resident?.room ?? loadSessionRoomConfig(sessionId);
  if (!config) return null;
  const persisted = resident ? null : await loadPersistedSession(sessionId);
  const title = resident?.title ?? persisted?.title ?? "Group room";
  return summarizeRoom(sessionId, title || "Group room", config);
}

export async function updateRoomSession(
  sessionId: string,
  patch: Partial<CreateRoomInput>
): Promise<RoomSessionSummary> {
  if (!isRoomSessionId(sessionId)) {
    throw new Error("Validation error: Session is not a group room");
  }
  const existing = getResidentChatSession(sessionId)?.room ?? loadSessionRoomConfig(sessionId);
  if (!existing) throw new Error("Room not found");
  const config = validateRoomConfig({
    participantAgentIds: patch.participantAgentIds ?? existing.participantAgentIds,
    mode: patch.mode ?? existing.mode,
    maxRounds: patch.maxRounds ?? existing.maxRounds,
    moderatorAgentId:
      patch.moderatorAgentId !== undefined ? patch.moderatorAgentId : existing.moderatorAgentId,
    sharedContext: patch.sharedContext ?? existing.sharedContext,
  });
  const session = getResidentChatSession(sessionId);
  const primaryAgentId = config.participantAgentIds.includes(session?.agentId || "")
    ? (session?.agentId as string)
    : config.participantAgentIds[0];
  persistSessionRoomConfig(sessionId, primaryAgentId, config);
  if (session) {
    session.room = config;
    session.agentId = primaryAgentId;
  }
  const summary = await getRoomSummary(sessionId);
  if (!summary) throw new Error("Room not found");
  return summary;
}
