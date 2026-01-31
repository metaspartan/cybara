import { tables } from "./database";
import { randomUUID } from "crypto";

// Log levels
export type LogLevel = "debug" | "info" | "warn" | "error";

// Log sources
export type LogSource = "agent" | "channel" | "tool" | "system" | "skill" | "subagent";

// Logger class for structured logging
export class Logger {
  private source: LogSource;

  constructor(source: LogSource) {
    this.source = source;
  }

  private async log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    const logEntry = {
      id: randomUUID(),
      level,
      source: this.source,
      message,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    };

    try {
      await tables.systemLogs.add(logEntry);
    } catch (error) {
      console.error("[Logger] Failed to write log:", error);
    }

    // Also log to console
    const timestamp = new Date().toISOString();
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
    console.log(`[${timestamp}] [${this.source}] [${level.toUpperCase()}] ${message}${metaStr}`);
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

// Create loggers for different components
export const agentLogger = new Logger("agent");
export const channelLogger = new Logger("channel");
export const toolLogger = new Logger("tool");
export const systemLogger = new Logger("system");
export const skillLogger = new Logger("skill");
export const subagentLogger = new Logger("subagent");

// Session message logging
export async function logSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  options?: {
    agentId?: string;
    channelType?: string;
    channelId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const message = {
    id: randomUUID(),
    session_id: sessionId,
    agent_id: options?.agentId,
    channel_type: options?.channelType,
    channel_id: options?.channelId,
    role,
    content,
    metadata: options?.metadata ? JSON.stringify(options.metadata) : undefined,
  };

  try {
    await tables.sessionMessages.add(message);
  } catch (error) {
    console.error("[Logger] Failed to log session message:", error);
  }
}

// Agent activity logging
export async function logAgentActivity(
  agentId: string,
  action: string,
  details?: string,
  metadata?: Record<string, unknown>
) {
  const logEntry = {
    id: randomUUID(),
    agent_id: agentId,
    action,
    details,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
  };

  try {
    await tables.agentLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log agent activity:", error);
  }
}

// Channel message logging
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
  const logEntry = {
    id: randomUUID(),
    channel_type: channelType,
    channel_id: options?.channelId,
    direction,
    sender_id: options?.senderId,
    content,
    metadata: options?.metadata ? JSON.stringify(options.metadata) : undefined,
  };

  try {
    await tables.channelLogs.add(logEntry);
  } catch (error) {
    console.error("[Logger] Failed to log channel message:", error);
  }
}

// Query functions for logs
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

// Get recent activity summary
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

// Export default logger instance
export default systemLogger;
