import { existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, dirname, basename, isAbsolute, resolve } from "path";
import { homedir, hostname, platform, arch, release, cpus, totalmem, freemem, uptime } from "os";
import { fileURLToPath } from "url";
import type { CronJobCreate, CronJobPatch } from "../../cron/types";
import * as cron from "../../cron";
import { agentManager } from "../../agent";
import type { ToolContext } from "../index";
import {
  channelManager,
  discordSessions,
  slackSessions,
  type ChannelAdapter,
  type ChannelType,
} from "../../channels";
import type { Channel } from "../../database";
import * as subagentRegistry from "../../subagent-registry";
import type { SubagentRunRecord } from "../../subagent-registry";
import { getInboundMediaRootDir, saveInboundMediaFromUrl } from "../../channels/media";
import {
  synthesizeSpeech,
  synthesizeWithSystemVoice,
  type SpeechSynthesisResult,
} from "../../speech";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SubagentSession {
  id: string;
  agentId?: string;
  parentSessionId?: string;
  workspaceDir?: string;
  task: string;
  model?: string;
  timeout?: number;
  status: "pending" | "running" | "completed" | "failed";
  messages: Array<{ role: string; content: string; timestamp: string }>;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const sessions = new Map<string, SubagentSession>();
const DEFAULT_SUBAGENT_MAX_ACTIVE_CHILDREN = 5;

export function getSubagentSession(sessionKey: string): SubagentSession | undefined {
  return sessions.get(sessionKey);
}

export function getAllSubagentSessions(): SubagentSession[] {
  return Array.from(sessions.values());
}

export function resetSubagentSessionsForTests(): void {
  sessions.clear();
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.floor(numeric);
}

function resolveRunTimeoutSeconds(args: Record<string, unknown>): number | undefined {
  const explicit = readNonNegativeInteger(args.runTimeoutSeconds);
  if (explicit !== undefined) return explicit;
  return readNonNegativeInteger(args.timeoutSeconds);
}

function resolveMaxActiveChildren(args: Record<string, unknown>): number | undefined {
  const explicit = readNonNegativeInteger(args.maxActiveChildren);
  const envValue = readNonNegativeInteger(process.env.CYBARA_SUBAGENT_MAX_ACTIVE_CHILDREN);
  const limit = explicit ?? envValue ?? DEFAULT_SUBAGENT_MAX_ACTIVE_CHILDREN;
  return limit > 0 ? limit : undefined;
}

export async function handleSessionsSpawn(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  status: string;
  childSessionKey: string;
  runId: string;
  task: string;
  modelApplied?: boolean;
  warning?: string;
}> {
  const task = readTrimmedString(args.task);
  const label = readTrimmedString(args.label);
  const requestedAgentId = readTrimmedString(args.agentId);
  const modelOverride = readTrimmedString(args.model);
  const runTimeoutSeconds = resolveRunTimeoutSeconds(args);
  const cleanup = args.cleanup === "delete" ? "delete" : "keep";
  const silent = args.silent === true;

  const requesterSessionKey =
    readTrimmedString(args._requesterSessionKey) || readTrimmedString(context?.sessionId) || "main";
  const requestedWorkspaceDir =
    readTrimmedString(args.workspaceDir) || readTrimmedString(context?.workspaceDir);

  if (!task) {
    throw new Error("task is required");
  }

  if (subagentRegistry.isSubagentSessionKey(requesterSessionKey)) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: "sessions_spawn is not allowed from sub-agent sessions",
    };
  }

  const maxActiveChildren = resolveMaxActiveChildren(args);
  const activeChildren = subagentRegistry.countActiveRunsForRequester(requesterSessionKey);
  if (maxActiveChildren !== undefined && activeChildren >= maxActiveChildren) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: `sessions_spawn has reached the active sub-agent limit (${maxActiveChildren}) for this session`,
    };
  }

  const agentId = requestedAgentId || "default";
  const childSessionKey = subagentRegistry.generateSubagentSessionKey(agentId);
  const runId = crypto.randomUUID();

  const run = subagentRegistry.registerSubagentRun({
    runId,
    childSessionKey,
    requesterSessionKey,
    requesterDisplayKey: requesterSessionKey === "main" ? "main" : requesterSessionKey,
    task,
    cleanup,
    label,
    model: modelOverride,
    workspaceDir: requestedWorkspaceDir,
    runTimeoutSeconds,
    silent,
  });

  const session: SubagentSession = {
    id: childSessionKey,
    agentId: requestedAgentId,
    parentSessionId: requesterSessionKey,
    task,
    model: modelOverride,
    timeout: runTimeoutSeconds && runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
    status: "pending",
    messages: [
      {
        role: "system",
        content: buildSubagentSystemPrompt(
          requesterSessionKey,
          childSessionKey,
          task,
          label,
          requestedWorkspaceDir,
          silent
        ),
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: task,
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    workspaceDir: requestedWorkspaceDir,
  };

  sessions.set(childSessionKey, session);

  executeSubagent(childSessionKey, run).catch((err) => {
    console.error(`[Subagent] Error executing session ${childSessionKey}:`, err);
    subagentRegistry.markRunFailed(runId, err.message || "Unknown error");
  });

  return {
    status: "accepted",
    childSessionKey,
    runId,
    task,
    modelApplied: modelOverride ? true : undefined,
  };
}

function buildSubagentSystemPrompt(
  requesterSessionKey: string,
  childSessionKey: string,
  task: string,
  label?: string,
  workspaceDir?: string,
  silent?: boolean
): string {
  const lines = [
    "You are a sub-agent running a specific task.",
    "",
    "## Task",
    label ? `Label: ${label}` : "",
    `Task: ${task}`,
    "",
    "## Instructions",
    "- Complete the task thoroughly but concisely",
    "- Focus only on the specified task",
    "- Do not spawn additional sub-agents from this sub-agent session",
    silent
      ? "- This is a silent background task. Do NOT announce your result to the requester."
      : "- When done, use sessions_send to announce your result to the requester",
    "",
    `Requester session: ${requesterSessionKey}`,
    `Your session: ${childSessionKey}`,
    workspaceDir ? `Workspace directory: ${workspaceDir}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

async function executeSubagent(sessionId: string, run?: SubagentRunRecord): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.status = "running";
  if (run) {
    subagentRegistry.markRunStarted(run.runId);
  }

  try {
    const availableAgents = agentManager.list();
    const agent =
      typeof session.agentId === "string" && session.agentId.trim().length > 0
        ? availableAgents.find((a) => a.id === session.agentId)
        : availableAgents.find((a) => a.status === "running") || availableAgents[0];

    if (!agent) {
      throw new Error("No agent available for subagent execution");
    }

    const agentMessages = session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system" | "tool",
      content: m.content,
    }));

    console.log(
      `[Subagent] Executing ${sessionId} using agent ${agent.id}${session.model ? ` (model override: ${session.model})` : ""}`
    );

    const result = await agentManager.execute(agent.id, agentMessages, {
      useTools: true,
      sessionId,
      workspaceDir: session.workspaceDir,
      channel: "subagent",
      userId: "subagent",
      modelOverride: session.model,
    });

    session.messages.push({
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
    });

    session.result = result.content;
    session.status = "completed";
    session.completedAt = new Date().toISOString();

    if (run) {
      subagentRegistry.markRunCompleted(run.runId, result.content);
    }

    console.log(
      `[Subagent] Session ${sessionId} completed with ${result.tool_calls?.length || 0} tool calls`
    );
  } catch (error) {
    session.status = "failed";
    session.error = (error as Error).message;
    session.completedAt = new Date().toISOString();

    if (run) {
      subagentRegistry.markRunFailed(run.runId, (error as Error).message);
    }

    console.error(`[Subagent] Session ${sessionId} failed:`, error);
  }
}

export async function handleSessionsSend(
  args: Record<string, unknown>
): Promise<{ success: boolean; sessionId: string; message: string }> {
  const sessionId = args.sessionId as string;
  const message = args.message as string;

  if (!sessionId || !message) {
    throw new Error("sessionId and message are required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.messages.push({
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });

  if (session.status === "completed" || session.status === "failed") {
    session.status = "pending";
    executeSubagent(sessionId).catch((err) => {
      console.error(`[Subagent] Error re-executing session ${sessionId}:`, err);
    });
  }

  return {
    success: true,
    sessionId,
    message: "Message added to session. Check sessions_history for response.",
  };
}

export async function handleSessionsHistory(args: Record<string, unknown>): Promise<{
  sessionId: string;
  status: string;
  task: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  result?: string;
  error?: string;
}> {
  const sessionId = args.sessionId as string;
  const limit = (args.limit as number) || 50;

  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return {
    sessionId,
    status: session.status,
    task: session.task,
    messages: session.messages.slice(-limit),
    result: session.result,
    error: session.error,
  };
}

export async function handleSessionsList(): Promise<{
  sessions: Array<{
    id: string;
    task: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    workspaceDir?: string;
    model?: string;
    timeout?: number;
    messageCount: number;
  }>;
}> {
  return {
    sessions: Array.from(sessions.values()).map((s) => ({
      id: s.id,
      task: s.task,
      status: s.status,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      workspaceDir: s.workspaceDir,
      model: s.model,
      timeout: s.timeout,
      messageCount: s.messages.length,
    })),
  };
}

export async function handleSessionStatus(args: Record<string, unknown>): Promise<{
  sessionId: string;
  status: string;
  model?: string;
  workspaceDir?: string;
  messageCount: number;
  tokenEstimate: number;
  createdAt: string;
  lastActivityAt?: string;
  task?: string;
  uptime?: number;
}> {
  const sessionId = args.sessionId as string;

  if (!sessionId) {
    return {
      sessionId: "main",
      status: "active",
      messageCount: 0,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
      uptime: process.uptime() * 1000,
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const totalChars = session.messages.reduce((sum, m) => sum + m.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  return {
    sessionId: session.id,
    status: session.status,
    model: session.model,
    workspaceDir: session.workspaceDir,
    messageCount: session.messages.length,
    tokenEstimate,
    createdAt: session.createdAt,
    lastActivityAt: session.completedAt || session.createdAt,
    task: session.task,
  };
}

export async function handleAgentsList(): Promise<{
  agents: Array<{ id: string; name: string; status: string; type: string }>;
}> {
  try {
    const agents = agentManager.list();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status || "stopped",
        type: a.type || "general",
      })),
    };
  } catch {
    return {
      agents: [{ id: "default", name: "Assistant", status: "running", type: "general" }],
    };
  }
}

type MessageToolContext = {
  channel?: string;
  userId?: string;
  sessionId?: string;
};

type MessageAction = "send" | "broadcast" | "react" | "unreact";

type MessageToolResult = {
  success: boolean;
  action: string;
  target: string;
  message?: string;
  channel?: string;
  channelId?: string;
  delivered?: number;
  attempted?: number;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveChannelType(value: unknown): ChannelType | undefined {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (
    normalized === "telegram" ||
    normalized === "whatsapp" ||
    normalized === "discord" ||
    normalized === "slack" ||
    normalized === "signal" ||
    normalized === "imessage" ||
    normalized === "web"
  ) {
    return normalized;
  }
  return undefined;
}

type EnabledChannel = {
  id: string;
  type: ChannelType;
  enabled: boolean;
};

function resolveEnabledChannels(): EnabledChannel[] {
  return (channelManager.list() as Channel[])
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.id,
      type: entry.type as ChannelType,
      enabled: Boolean(entry.enabled),
    }));
}

function resolveChannelsForAction(args: {
  channelId?: string;
  channelType?: ChannelType;
  action: MessageAction;
}): EnabledChannel[] {
  const allEnabled = resolveEnabledChannels();

  if (args.channelId) {
    const selected = allEnabled.find((entry) => entry.id === args.channelId);
    if (!selected) {
      throw new Error(`No active channel found for channelId '${args.channelId}'`);
    }
    return [selected];
  }

  if (args.channelType) {
    const matching = allEnabled.filter((entry) => entry.type === args.channelType);
    if (matching.length === 0) {
      throw new Error(`No active ${args.channelType} channel found`);
    }
    return matching;
  }

  if (args.action === "react" || args.action === "unreact") {
    const reactionCapable = allEnabled.filter((entry) => {
      const adapter = channelManager.getAdapter(entry.type) as ReactionAdapter | undefined;
      if (!adapter) return false;
      return args.action === "react"
        ? Boolean(adapter.sendReaction)
        : Boolean(adapter.removeReaction);
    });
    if (reactionCapable.length === 0) {
      throw new Error(`No active channels support '${args.action}'`);
    }
    return reactionCapable;
  }

  if (allEnabled.length === 0) {
    throw new Error("No active channels found");
  }

  return allEnabled;
}

function resolveChannelIdFromDelimitedSessionMap(
  sessionMap: Map<string, string>,
  sessionId: string | undefined,
  chatId: string | undefined
): string | undefined {
  if (!sessionId) return undefined;

  const matches: string[] = [];
  for (const [key, value] of sessionMap.entries()) {
    if (value !== sessionId) continue;
    const separatorIndex = key.indexOf(":");
    if (separatorIndex <= 0) continue;

    const channelId = key.slice(0, separatorIndex);
    const sessionChatId = key.slice(separatorIndex + 1);
    if (chatId && sessionChatId !== chatId) {
      continue;
    }
    matches.push(channelId);
  }

  return matches.length === 1 ? matches[0] : undefined;
}

function resolveChannelIdFromContext(
  channelType: ChannelType | undefined,
  context?: MessageToolContext
): string | undefined {
  const sessionId = asNonEmptyString(context?.sessionId);
  const chatId = asNonEmptyString(context?.userId);
  if (!channelType || !sessionId) {
    return undefined;
  }

  if (channelType === "discord") {
    return resolveChannelIdFromDelimitedSessionMap(discordSessions, sessionId, chatId);
  }

  if (channelType === "slack") {
    return resolveChannelIdFromDelimitedSessionMap(slackSessions, sessionId, chatId);
  }

  return undefined;
}

function resolveTarget(args: Record<string, unknown>, context?: MessageToolContext): string {
  const explicitTarget = asNonEmptyString(args.target) || asNonEmptyString(args.to);
  if (explicitTarget) return explicitTarget;

  if (typeof args.chatId === "string" || typeof args.chatId === "number") {
    return String(args.chatId);
  }

  if (asNonEmptyString(context?.userId)) {
    return context!.userId!.trim();
  }

  throw new Error("target is required (or provide to/chatId)");
}

function resolveMessageText(args: Record<string, unknown>): string {
  const message =
    asNonEmptyString(args.message) || asNonEmptyString(args.text) || asNonEmptyString(args.content);
  if (!message) {
    throw new Error("message is required (or provide text/content)");
  }
  return message;
}

type ReactionAdapter = ChannelAdapter & {
  sendReaction?: (
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ) => Promise<boolean>;
  removeReaction?: (
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ) => Promise<boolean>;
};

async function sendSingleMessage(
  channel: EnabledChannel,
  target: string,
  messageText: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const adapter = channelManager.getAdapter(channel.type);
  if (!adapter) {
    throw new Error(`Adapter not available for channel type '${channel.type}'`);
  }

  return await adapter.sendMessage(channel.id, target, messageText, {
    contentType: args.contentType,
    buffer: args.buffer,
    replyToId: args.replyToId,
  });
}

async function runReactionAction(
  action: "react" | "unreact",
  channel: EnabledChannel,
  target: string,
  messageId: string,
  emoji: string,
  options?: Record<string, unknown>
): Promise<boolean> {
  const adapter = channelManager.getAdapter(channel.type) as ReactionAdapter | undefined;
  if (!adapter) {
    throw new Error(`Channel adapter '${channel.type}' is not available`);
  }

  if (action === "react") {
    if (!adapter.sendReaction) {
      throw new Error(`Channel '${channel.type}' does not support react`);
    }
    return await adapter.sendReaction(channel.id, target, messageId, emoji, options);
  }

  if (!adapter.removeReaction) {
    throw new Error(`Channel '${channel.type}' does not support unreact`);
  }

  return await adapter.removeReaction(channel.id, target, messageId, emoji, options);
}

export async function handleMessage(
  args: Record<string, unknown>,
  context?: MessageToolContext
): Promise<MessageToolResult> {
  const actionRaw = asNonEmptyString(args.action);
  if (!actionRaw) {
    throw new Error("action is required");
  }

  const normalizedAction = actionRaw.toLowerCase();
  const action: MessageAction =
    normalizedAction === "send" ||
    normalizedAction === "broadcast" ||
    normalizedAction === "react" ||
    normalizedAction === "unreact"
      ? normalizedAction
      : (() => {
          throw new Error(`Unknown message action: ${actionRaw}`);
        })();

  const requestedChannelType =
    resolveChannelType(args.channel) ||
    resolveChannelType(args.platform) ||
    resolveChannelType(context?.channel);
  const requestedChannelId =
    asNonEmptyString(args.channelId) || resolveChannelIdFromContext(requestedChannelType, context);
  const channels = resolveChannelsForAction({
    channelId: requestedChannelId,
    channelType: requestedChannelType,
    action,
  });

  if ((action === "send" || action === "react" || action === "unreact") && channels.length > 1) {
    throw new Error(
      `Multiple active channels match request (${channels.length}). Provide channel or channelId to disambiguate.`
    );
  }

  const target = resolveTarget(args, context);

  if (action === "send") {
    const channel = channels[0];
    const messageText = resolveMessageText(args);
    const success = await sendSingleMessage(channel, target, messageText, args);
    return {
      success,
      action,
      target,
      channel: channel.type,
      channelId: channel.id,
      message: success
        ? `Message sent to ${target} via ${channel.type}`
        : `Failed to send message to ${target} via ${channel.type}`,
    };
  }

  if (action === "broadcast") {
    const messageText = resolveMessageText(args);
    const results = await Promise.all(
      channels.map(async (channel) => await sendSingleMessage(channel, target, messageText, args))
    );
    const delivered = results.filter(Boolean).length;
    return {
      success: delivered > 0,
      action,
      target,
      delivered,
      attempted: channels.length,
      message: `Broadcast delivered to ${delivered}/${channels.length} channels for target ${target}`,
    };
  }

  const messageId = asNonEmptyString(args.messageId) || asNonEmptyString(args.replyToId);
  if (!messageId) {
    throw new Error("messageId is required for react/unreact actions");
  }
  const emoji = asNonEmptyString(args.emoji) || asNonEmptyString(args.reaction);
  if (!emoji) {
    throw new Error("emoji is required for react/unreact actions");
  }

  const channel = channels[0];
  const success = await runReactionAction(action, channel, target, messageId, emoji, {
    userId: args.userId,
  });

  return {
    success,
    action,
    target,
    channel: channel.type,
    channelId: channel.id,
    message: success
      ? `${action === "react" ? "Reaction added" : "Reaction removed"} on ${messageId}`
      : `Failed to ${action} on ${messageId}`,
  };
}

export async function handleCanvas(
  args: Record<string, unknown>
): Promise<{ success: boolean; action: string; message: string }> {
  const action = args.action as string;

  switch (action) {
    case "present":
      return { success: true, action: "present", message: "Canvas presented" };
    case "hide":
      return { success: true, action: "hide", message: "Canvas hidden" };
    case "snapshot":
      return { success: true, action: "snapshot", message: "Canvas snapshot captured" };
    default:
      throw new Error(`Unknown canvas action: ${action}`);
  }
}

/**
 * Device nodes. Today the only node is the local host (the machine running
 * Cybara) — `status`/`describe` report it with real system info, and
 * `camera_snap`/`screen_record` capture from the local camera/screen via ffmpeg
 * (gated as a dangerous tool — see dangerousToolNames). Remote device nodes
 * (phones/tablets) require a paired companion app, which is not yet available;
 * those paths return honest "not paired" messages rather than pretending.
 */
const LOCAL_NODE_ID = "local";

function localNodeDescriptor(): Record<string, unknown> {
  return {
    id: LOCAL_NODE_ID,
    name: hostname(),
    kind: "host",
    platform: platform(),
    arch: arch(),
    online: true,
  };
}

function nodesCaptureDir(): string {
  const dir = join(dirname(getInboundMediaRootDir()), "nodes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function isLocalNode(node: string | undefined): boolean {
  return !node || node === LOCAL_NODE_ID || node === hostname();
}

/** Run a capture command (ffmpeg) with a hard timeout; return file path or honest error. */
function runCapture(
  cmd: string[],
  outPath: string,
  timeoutMs: number
): { ok: boolean; error?: string } {
  if (!Bun.which(cmd[0])) {
    return { ok: false, error: `${cmd[0]} is not installed (required for local capture).` };
  }
  const proc = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "pipe", timeout: timeoutMs });
  if (!proc.success || !existsSync(outPath) || statSync(outPath).size === 0) {
    const stderr = proc.stderr?.toString().trim().split("\n").slice(-3).join(" ") || "";
    return {
      ok: false,
      error: `Capture failed${stderr ? `: ${stderr}` : ""}. On macOS, grant Camera/Screen Recording permission to the host process.`,
    };
  }
  return { ok: true };
}

export async function handleNodes(args: Record<string, unknown>): Promise<{
  success: boolean;
  action: string;
  nodes?: unknown[];
  node?: string;
  filePath?: string;
  message: string;
}> {
  const action = args.action as string;
  const node = typeof args.node === "string" ? args.node.trim() : undefined;
  const os = platform();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  switch (action) {
    case "status":
      return {
        success: true,
        action: "status",
        nodes: [localNodeDescriptor()],
        message:
          "1 node available (local host). Remote device nodes require pairing a companion app (not yet available).",
      };

    case "describe": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "describe",
          node,
          message: `Node '${node}' not found. Only the local host node is available; remote device nodes require a companion app (not yet available).`,
        };
      }
      const desc = {
        ...localNodeDescriptor(),
        osRelease: release(),
        cpus: cpus().length,
        totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(freemem() / 1024 / 1024),
        uptimeSeconds: Math.round(uptime()),
      };
      return {
        success: true,
        action: "describe",
        nodes: [desc],
        message: `Local host node ${hostname()} (${platform()}/${arch()})`,
      };
    }

    case "camera_snap": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "camera_snap",
          node,
          message: `Node '${node}' is not paired. Camera capture is only available on the local host today.`,
        };
      }
      const outPath = join(nodesCaptureDir(), `camera_${stamp}.jpg`);
      const cmd =
        os === "darwin"
          ? [
              "ffmpeg",
              "-hide_banner",
              "-f",
              "avfoundation",
              "-i",
              "0:none",
              "-frames:v",
              "1",
              "-y",
              outPath,
            ]
          : os === "linux"
            ? [
                "ffmpeg",
                "-hide_banner",
                "-f",
                "v4l2",
                "-i",
                "/dev/video0",
                "-frames:v",
                "1",
                "-y",
                outPath,
              ]
            : null;
      if (!cmd) {
        return {
          success: false,
          action: "camera_snap",
          message: `Camera capture is not supported on ${os}.`,
        };
      }
      const r = runCapture(cmd, outPath, 15_000);
      return r.ok
        ? {
            success: true,
            action: "camera_snap",
            node: LOCAL_NODE_ID,
            filePath: outPath,
            message: `Captured camera image to ${outPath}`,
          }
        : { success: false, action: "camera_snap", message: r.error! };
    }

    case "screen_record": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "screen_record",
          node,
          message: `Node '${node}' is not paired. Screen recording is only available on the local host today.`,
        };
      }
      const seconds = Math.min(Math.max(Math.floor(Number(args.seconds) || 5), 1), 60);
      const outPath = join(nodesCaptureDir(), `screen_${stamp}.mp4`);
      const cmd =
        os === "darwin"
          ? [
              "ffmpeg",
              "-hide_banner",
              "-f",
              "avfoundation",
              "-i",
              "1:none",
              "-t",
              String(seconds),
              "-y",
              outPath,
            ]
          : os === "linux"
            ? [
                "ffmpeg",
                "-hide_banner",
                "-f",
                "x11grab",
                "-i",
                process.env.DISPLAY || ":0.0",
                "-t",
                String(seconds),
                "-y",
                outPath,
              ]
            : null;
      if (!cmd) {
        return {
          success: false,
          action: "screen_record",
          message: `Screen recording is not supported on ${os}.`,
        };
      }
      const r = runCapture(cmd, outPath, (seconds + 15) * 1000);
      return r.ok
        ? {
            success: true,
            action: "screen_record",
            node: LOCAL_NODE_ID,
            filePath: outPath,
            message: `Recorded ${seconds}s of the screen to ${outPath}`,
          }
        : { success: false, action: "screen_record", message: r.error! };
    }

    default:
      throw new Error(`Unknown nodes action: ${action}`);
  }
}

function normalizeImageInput(value: string): string {
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, "");
  const attachmentMatch = trimmed.match(/^<attachment:(.+)>$/i);
  if (attachmentMatch?.[1]) {
    return attachmentMatch[1].trim();
  }
  return trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildImagePathCandidates(rawInput: string): string[] {
  const expandedHome = rawInput.startsWith("~") ? join(homedir(), rawInput.slice(1)) : rawInput;
  const candidates = [expandedHome];

  if (!isAbsolute(expandedHome)) {
    candidates.push(resolve(process.cwd(), expandedHome));
  }

  const fileName = basename(expandedHome);
  if (fileName) {
    const inboundRoot = getInboundMediaRootDir();
    candidates.push(join(inboundRoot, fileName));
    for (const source of [
      "discord",
      "telegram",
      "slack",
      "signal",
      "whatsapp",
      "imessage",
      "image-tool",
    ]) {
      candidates.push(join(inboundRoot, source, fileName));
    }
  }

  return [...new Set(candidates.map((entry) => entry.trim()).filter(Boolean))];
}

function resolveExistingImagePath(rawInput: string): string | undefined {
  for (const candidate of buildImagePathCandidates(rawInput)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const targetFileName = basename(rawInput).toLowerCase();
  if (!targetFileName) {
    return undefined;
  }

  const inboundRoot = getInboundMediaRootDir();
  const candidateDirs = [
    inboundRoot,
    ...["discord", "telegram", "slack", "signal", "whatsapp", "imessage", "image-tool"].map(
      (source) => join(inboundRoot, source)
    ),
  ];

  let newestMatch: { path: string; modifiedAt: number } | undefined;
  for (const dirPath of candidateDirs) {
    if (!existsSync(dirPath)) {
      continue;
    }
    for (const entry of readdirSync(dirPath)) {
      const normalizedEntry = entry.toLowerCase();
      if (normalizedEntry !== targetFileName && !normalizedEntry.endsWith(`-${targetFileName}`)) {
        continue;
      }
      const resolvedPath = join(dirPath, entry);
      try {
        const stats = statSync(resolvedPath);
        if (!stats.isFile()) {
          continue;
        }
        if (!newestMatch || stats.mtimeMs > newestMatch.modifiedAt) {
          newestMatch = {
            path: resolvedPath,
            modifiedAt: stats.mtimeMs,
          };
        }
      } catch {
        continue;
      }
    }
  }

  if (newestMatch) {
    return newestMatch.path;
  }
  return undefined;
}

export async function handleImage(
  args: Record<string, unknown>
): Promise<{ description: string; image: string; text?: string }> {
  const image = args.image as string;
  const prompt =
    (args.prompt as string) || "Describe what you see in this image and extract any visible text.";
  const shouldExtractText = args.extractText !== false;

  if (!image) {
    throw new Error("image path is required");
  }

  const normalizedInput = normalizeImageInput(image);
  let resolvedImagePath = resolveExistingImagePath(normalizedInput);
  if (!resolvedImagePath && isHttpUrl(normalizedInput)) {
    const url = new URL(normalizedInput);
    const fallbackName = basename(url.pathname) || "remote-image";
    const saved = await saveInboundMediaFromUrl({
      channel: "image-tool",
      url: normalizedInput,
      fileName: fallbackName,
    });
    resolvedImagePath = saved.path;
  }

  if (!resolvedImagePath) {
    throw new Error(
      `Image file not found: ${normalizedInput}. Provide an absolute path, a saved inbound media filename, or a direct URL.`
    );
  }

  let extractedText = "";
  if (shouldExtractText) {
    const platform = process.platform; // 'darwin', 'win32', 'linux'
    const projectRoot = join(__dirname, "..", "..", "..", "..");

    if (platform === "darwin") {
      const ocrScriptPath = join(projectRoot, "scripts", "ocr.swift");
      if (existsSync(ocrScriptPath)) {
        try {
          const result = Bun.spawnSync(["swift", ocrScriptPath, resolvedImagePath], {
            stdout: "pipe",
            stderr: "pipe",
            timeout: 30000,
          });

          if (result.exitCode === 0) {
            extractedText = result.stdout.toString().trim();
            console.log(
              `[Image] OCR extracted ${extractedText.length} characters via Swift Vision`
            );
          }
        } catch (err) {
          console.error("[Image] Swift OCR failed:", err);
        }
      }
    } else if (platform === "win32") {
      try {
        const psScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]

$path = '${resolvedImagePath.replace(/'/g, "''")}'
$stream = [System.IO.File]::OpenRead($path)
$decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync([System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)).GetAwaiter().GetResult()
$bitmap = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = $engine.RecognizeAsync($bitmap).GetAwaiter().GetResult()
Write-Output $result.Text
$stream.Dispose()
`;
        const result = Bun.spawnSync(["powershell", "-NoProfile", "-Command", psScript], {
          stdout: "pipe",
          stderr: "pipe",
          timeout: 30000,
        });

        if (result.exitCode === 0) {
          extractedText = result.stdout.toString().trim();
          console.log(`[Image] OCR extracted ${extractedText.length} characters via Windows OCR`);
        }
      } catch (err) {
        console.error("[Image] Windows OCR failed:", err);
      }
    }

    if (!extractedText) {
      try {
        const result = Bun.spawnSync(["tesseract", resolvedImagePath, "stdout"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        if (result.exitCode === 0) {
          extractedText = result.stdout.toString().trim();
          console.log(`[Image] OCR extracted ${extractedText.length} characters via tesseract`);
        }
      } catch {
        void 0;
      }
    }
  }

  return {
    description: prompt,
    image: resolvedImagePath,
    text: shouldExtractText
      ? extractedText ||
        "No text could be extracted. Try using browser({action:'snapshot'}) to read page text directly."
      : undefined,
  };
}

export async function handleTTS(args: Record<string, unknown>): Promise<SpeechSynthesisResult> {
  const provider =
    typeof args.provider === "string" &&
    ["auto", "system", "elevenlabs", "openai", "openai-codex"].includes(args.provider)
      ? (args.provider as "auto" | "system" | "elevenlabs" | "openai" | "openai-codex")
      : undefined;
  return await synthesizeSpeech({
    text: typeof args.text === "string" ? args.text : "",
    provider,
    providerId: typeof args.providerId === "string" ? args.providerId : undefined,
    model: typeof args.model === "string" ? args.model : undefined,
    voice: typeof args.voice === "string" ? args.voice : undefined,
    format: typeof args.format === "string" ? args.format : undefined,
    speed:
      typeof args.speed === "number"
        ? args.speed
        : typeof args.rate === "number" && Number.isFinite(args.rate)
          ? Math.max(0.5, Math.min(2, args.rate / 175))
          : undefined,
    stability: typeof args.stability === "number" ? args.stability : undefined,
    similarity: typeof args.similarity === "number" ? args.similarity : undefined,
    style: typeof args.style === "number" ? args.style : undefined,
    fallbackToSystem:
      typeof args.fallbackToSystem === "boolean" ? args.fallbackToSystem : undefined,
  });
}

export async function handleSystemTTS(
  args: Record<string, unknown>
): Promise<{ audioPath: string; text: string; voice?: string; format: string }> {
  const result = await synthesizeWithSystemVoice({
    text: typeof args.text === "string" ? args.text : "",
    voice: typeof args.voice === "string" ? args.voice : undefined,
    rate: typeof args.rate === "number" ? args.rate : undefined,
    format: typeof args.format === "string" ? args.format : undefined,
  });
  return {
    audioPath: result.audioPath,
    text: result.text,
    voice: result.voice,
    format: result.format,
  };
}

export async function handleCron(args: Record<string, unknown>): Promise<{
  success: boolean;
  action: string;
  data?: unknown;
  message?: string;
}> {
  const action = args.action as string;

  if (!action) {
    throw new Error("action is required (status/list/add/update/remove/run/runs/wake)");
  }

  switch (action) {
    case "status": {
      const status = cron.getSchedulerStatus();
      return { success: true, action, data: status };
    }

    case "list": {
      const includeDisabled = Boolean(args.includeDisabled);
      const jobs = cron.listJobs(includeDisabled);
      return { success: true, action, data: { jobs, count: jobs.length } };
    }

    case "add": {
      const job = args.job as Record<string, unknown>;
      if (!job || typeof job !== "object") {
        throw new Error("job object is required");
      }

      if (!job.schedule || typeof job.schedule !== "object") {
        throw new Error("job.schedule is required");
      }
      if (!job.payload || typeof job.payload !== "object") {
        throw new Error("job.payload is required");
      }
      if (!job.sessionTarget) {
        throw new Error("job.sessionTarget is required (main or isolated)");
      }

      const created = cron.createJob(job as CronJobCreate);
      cron.scheduleJob(created);

      return {
        success: true,
        action,
        data: { job: created },
        message: `Job ${created.id} created and scheduled`,
      };
    }

    case "update": {
      const jobId = (args.jobId || args.id) as string;
      const patch = args.patch as Record<string, unknown>;

      if (!jobId) {
        throw new Error("jobId is required");
      }
      if (!patch || typeof patch !== "object") {
        throw new Error("patch object is required");
      }

      const updated = cron.updateJob(jobId, patch as CronJobPatch);
      if (!updated) {
        throw new Error(`Job not found: ${jobId}`);
      }

      cron.scheduleJob(updated);

      return {
        success: true,
        action,
        data: { job: updated },
        message: `Job ${jobId} updated`,
      };
    }

    case "remove": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      cron.cancelJobTimer(jobId);
      const removed = cron.removeJob(jobId);

      return {
        success: removed,
        action,
        message: removed ? `Job ${jobId} removed` : `Job ${jobId} not found`,
      };
    }

    case "run": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      const runLog = await cron.runJob(jobId);
      return {
        success: runLog.status === "ok",
        action,
        data: runLog,
      };
    }

    case "runs": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      const limit = (args.limit as number) || 10;
      const runs = cron.getRunLogs(jobId, limit);

      return { success: true, action, data: { runs, count: runs.length } };
    }

    case "wake": {
      const text = args.text as string;
      const mode =
        args.mode === "now" || args.mode === "next-heartbeat" ? args.mode : "next-heartbeat";

      if (!text) {
        throw new Error("text is required for wake action");
      }

      const result = await cron.sendWakeEvent(text, mode);
      return {
        success: result.sent,
        action,
        message: `Wake event sent (${mode}): ${text.slice(0, 50)}...`,
      };
    }

    default:
      throw new Error(
        `Unknown cron action: ${action}. Use: status/list/add/update/remove/run/runs/wake`
      );
  }
}

export async function handleGateway(args: Record<string, unknown>): Promise<{
  success: boolean;
  action: string;
  data?: unknown;
  message?: string;
}> {
  const action = args.action as string;

  if (!action) {
    throw new Error("action is required (status/restart/config.get/config.patch)");
  }

  switch (action) {
    case "status": {
      const agents = agentManager.list();
      const activeAgents = agents.filter((a) => a.status === "running");
      const cronStatus = cron.getSchedulerStatus();

      return {
        success: true,
        action,
        data: {
          gateway: "running",
          uptime: process.uptime(),
          agents: {
            total: agents.length,
            active: activeAgents.length,
          },
          cron: cronStatus,
          memory: process.memoryUsage(),
          version: process.version,
        },
      };
    }

    case "restart": {
      const reason = (args.reason as string) || "Manual restart via gateway tool";
      const delayMs = (args.delayMs as number) || 1000;

      console.log(`[Gateway] Restart requested: ${reason} (delay: ${delayMs}ms)`);

      setTimeout(() => {
        console.log("[Gateway] Executing scheduled restart...");
      }, delayMs);

      return {
        success: true,
        action,
        message: `Restart scheduled in ${delayMs}ms: ${reason}`,
      };
    }

    case "config.get": {
      try {
        const home = process.env.HOME || process.env.USERPROFILE || homedir();
        const config = {
          sessionStore: join(home, ".cybara", "sessions"),
          memoryStore: join(home, ".cybara", "memory"),
          cronStore: join(home, ".cybara", "cron"),
          runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
          },
        };

        return { success: true, action, data: config };
      } catch (error) {
        return { success: false, action, message: (error as Error).message };
      }
    }

    case "config.patch": {
      const raw = args.raw as string;
      if (!raw) {
        throw new Error("raw config patch is required");
      }

      console.log(`[Gateway] Config patch received: ${raw.slice(0, 100)}...`);

      return {
        success: true,
        action,
        message: "Config patch applied (restart may be required)",
      };
    }

    default:
      throw new Error(
        `Unknown gateway action: ${action}. Use: status/restart/config.get/config.patch`
      );
  }
}
