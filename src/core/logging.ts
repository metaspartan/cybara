import { tables } from "./database";
import { randomUUID } from "crypto";
import { redactSecretText, redactSecrets } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSource = "agent" | "channel" | "tool" | "system" | "skill" | "subagent";

export class Logger {
  private source: LogSource;

  constructor(source: LogSource) {
    this.source = source;
  }

  private async log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    const safeMessage = redactSecretText(message);
    const safeMetadata = redactLogMetadata(metadata);
    const logEntry = {
      id: randomUUID(),
      level,
      source: this.source,
      message: safeMessage,
      metadata: safeMetadata ? JSON.stringify(safeMetadata) : undefined,
    };

    try {
      await tables.systemLogs.add(logEntry);
    } catch (error) {
      console.error("[Logger] Failed to write log:", error);
    }

    const timestamp = new Date().toISOString();
    const metaStr = safeMetadata ? ` ${JSON.stringify(safeMetadata)}` : "";
    console.log(
      `[${timestamp}] [${this.source}] [${level.toUpperCase()}] ${safeMessage}${metaStr}`
    );
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    return this.log("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    return this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    return this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    return this.log("error", message, metadata);
  }
}

export const agentLogger = new Logger("agent");
export const channelLogger = new Logger("channel");
export const toolLogger = new Logger("tool");
export const systemLogger = new Logger("system");
export const skillLogger = new Logger("skill");
export const subagentLogger = new Logger("subagent");

function redactLogMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  return metadata ? (redactSecrets(metadata) as Record<string, unknown>) : undefined;
}

// Storage caps for persisted session messages. Un-capped writes have produced
// single rows near 200MB (a giant tool result mirrored into metadata), which
// made every session-list query re-read hundreds of MB. Message content keeps
// head + tail; metadata beyond the cap carries no display value and is elided.
const SESSION_MESSAGE_CONTENT_MAX_CHARS = 2_000_000;
const SESSION_MESSAGE_CONTENT_TAIL_CHARS = 16_000;
const SESSION_MESSAGE_METADATA_MAX_CHARS = 262_144;

function capSessionMessageContent(content: string): string {
  if (content.length <= SESSION_MESSAGE_CONTENT_MAX_CHARS) return content;
  const head = content.slice(
    0,
    SESSION_MESSAGE_CONTENT_MAX_CHARS - SESSION_MESSAGE_CONTENT_TAIL_CHARS
  );
  const tail = content.slice(-SESSION_MESSAGE_CONTENT_TAIL_CHARS);
  return `${head}\n\n[...elided: oversized message truncated for storage...]\n\n${tail}`;
}

function capSessionMessageMetadata(metadataJson?: string): string | undefined {
  if (!metadataJson || metadataJson.length <= SESSION_MESSAGE_METADATA_MAX_CHARS) {
    return metadataJson;
  }
  return JSON.stringify({ elided: true, originalChars: metadataJson.length });
}

function normalizeCreatedAt(value?: string): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().replace("T", " ").replace("Z", "");
}

export async function logSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  options?: {
    agentId?: string;
    channelType?: string;
    channelId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }
) {
  const safeMetadata = redactLogMetadata(options?.metadata);
  const message = {
    id: randomUUID(),
    session_id: sessionId,
    agent_id: options?.agentId,
    channel_type: options?.channelType,
    channel_id: options?.channelId,
    role,
    content: capSessionMessageContent(content),
    metadata: capSessionMessageMetadata(safeMetadata ? JSON.stringify(safeMetadata) : undefined),
    created_at: normalizeCreatedAt(options?.createdAt),
  };

  try {
    await tables.sessionMessages.add(message);
  } catch (error) {
    console.error("[Logger] Failed to log session message:", error);
  }
}

export async function logAgentActivity(
  agentId: string,
  action: string,
  details?: string,
  metadata?: Record<string, unknown>
) {
  const safeMetadata = redactLogMetadata(metadata);
  const logEntry = {
    id: randomUUID(),
    agent_id: agentId,
    action: redactSecretText(action),
    details: details ? redactSecretText(details) : details,
    metadata: safeMetadata ? JSON.stringify(safeMetadata) : undefined,
  };

  try {
    await tables.agentLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log agent activity:", error);
  }
}

export async function logChannelMessage(
  channelType: string,
  direction: "incoming" | "outgoing",
  content: string,
  options?: {
    channelId?: string;
    senderId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const safeMetadata = redactLogMetadata(options?.metadata);
  const logEntry = {
    id: randomUUID(),
    channel_type: channelType,
    channel_id: options?.channelId,
    direction,
    sender_id: options?.senderId,
    content: redactSecretText(content),
    metadata: safeMetadata ? JSON.stringify(safeMetadata) : undefined,
  };

  try {
    await tables.channelLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log channel message:", error);
  }
}

export async function logToolExecution(
  toolName: string,
  status: "success" | "error",
  durationMs: number,
  options?: {
    sessionId?: string;
    agentId?: string;
    argsPreview?: string;
    error?: string;
  }
) {
  const message =
    status === "success"
      ? `Tool ${toolName} completed in ${durationMs}ms`
      : `Tool ${toolName} failed after ${durationMs}ms: ${options?.error || "Unknown error"}`;
  const safeMessage = redactSecretText(message);
  const safeMetadata = redactLogMetadata({
    toolName,
    status,
    durationMs,
    sessionId: options?.sessionId,
    agentId: options?.agentId,
    argsPreview: options?.argsPreview,
    error: options?.error,
  });

  const logEntry = {
    id: randomUUID(),
    level: status === "success" ? "info" : "error",
    source: "tool",
    message: safeMessage,
    metadata: JSON.stringify(safeMetadata),
  };

  try {
    await tables.systemLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log tool execution:", error);
  }
}

export async function logSkillExecution(
  skillName: string,
  status: "success" | "error",
  durationMs: number,
  options?: {
    sessionId?: string;
    agentId?: string;
    error?: string;
  }
) {
  const message =
    status === "success"
      ? `Skill ${skillName} executed in ${durationMs}ms`
      : `Skill ${skillName} failed: ${options?.error || "Unknown error"}`;
  const safeMessage = redactSecretText(message);
  const safeMetadata = redactLogMetadata({
    skillName,
    status,
    durationMs,
    sessionId: options?.sessionId,
    agentId: options?.agentId,
    error: options?.error,
  });

  const logEntry = {
    id: randomUUID(),
    level: status === "success" ? "info" : "error",
    source: "skill",
    message: safeMessage,
    metadata: JSON.stringify(safeMetadata),
  };

  try {
    await tables.systemLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log skill execution:", error);
  }
}

export async function getSystemLogs(options?: {
  level?: LogLevel;
  source?: LogSource;
  search?: string;
  limit?: number;
}) {
  if (options?.search) {
    return tables.systemLogs.search(options.search, options.limit || 100);
  }
  if (options?.level) {
    return tables.systemLogs.getByLevel(options.level);
  }
  if (options?.source) {
    return tables.systemLogs.getBySource(options.source);
  }
  return tables.systemLogs.list();
}

export async function getSessionMessages(sessionId: string) {
  return tables.sessionMessages.getBySession(sessionId);
}

export async function getAgentLogs(agentId: string) {
  return tables.agentLogs.getByAgent(agentId);
}

export async function getChannelLogs(channelType: string, channelId: string) {
  return tables.channelLogs.getByChannel(channelType, channelId);
}

export async function searchAllLogs(query: string, limit = 100) {
  const [system, sessionMessages, agentList, channelList] = await Promise.all([
    tables.systemLogs.search(query, limit),
    tables.sessionMessages.search(query, limit),
    tables.agentLogs.list(),
    tables.channelLogs.list(),
  ]);

  const agent = (agentList as Array<{ action?: string; details?: string }>).filter(
    (l) =>
      l.action?.toLowerCase().includes(query.toLowerCase()) ||
      l.details?.toLowerCase().includes(query.toLowerCase())
  );
  const channel = (channelList as Array<{ content?: string }>).filter((l) =>
    l.content?.toLowerCase().includes(query.toLowerCase())
  );

  return {
    system,
    sessionMessages,
    agent,
    channel,
  };
}

export async function getRecentActivity(minutes = 60) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const allSystemLogs = await tables.systemLogs.list();
  const allSessionMessages = await tables.sessionMessages.list();
  const allAgentLogs = await tables.agentLogs.list();
  const allChannelLogs = await tables.channelLogs.list();

  return {
    system: (allSystemLogs as Array<{ created_at: string }>).filter((l) => l.created_at > since),
    messages: (allSessionMessages as Array<{ created_at: string }>).filter(
      (m) => m.created_at > since
    ),
    agent: (allAgentLogs as Array<{ created_at: string }>).filter((l) => l.created_at > since),
    channel: (allChannelLogs as Array<{ created_at: string }>).filter((l) => l.created_at > since),
  };
}

export default systemLogger;
