export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  module?: string;
  sessionId?: string;
  channelId?: string;
  userId?: string;
  agentId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const MIN_LEVEL_PRIORITY = LOG_LEVELS[MIN_LOG_LEVEL] ?? 1;

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

function formatLogEntry(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const label = LEVEL_LABELS[entry.level];
  const time = entry.timestamp.split("T")[1]?.split(".")[0] || entry.timestamp;

  let line = `${COLORS.dim}${time}${COLORS.reset} ${color}${label}${COLORS.reset} [${COLORS.cyan}${entry.module}${COLORS.reset}] ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    const contextStr = Object.entries(entry.context)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    line += ` ${COLORS.dim}${contextStr}${COLORS.reset}`;
  }

  return line;
}

function log(
  level: LogLevel,
  module: string,
  message: string,
  context?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < MIN_LEVEL_PRIORITY) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    context,
  };

  const formattedLine = formatLogEntry(entry);

  if (level === "error") {
    console.error(formattedLine);
  } else if (level === "warn") {
    console.warn(formattedLine);
  } else {
    console.log(formattedLine);
  }
}

export function createLogger(module: string) {
  return {
    debug: (message: string, context?: LogContext) => log("debug", module, message, context),
    info: (message: string, context?: LogContext) => log("info", module, message, context),
    warn: (message: string, context?: LogContext) => log("warn", module, message, context),
    error: (message: string, context?: LogContext) => log("error", module, message, context),

    exception: (message: string, error: unknown, context?: LogContext) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      log("error", module, `${message}: ${errorMessage}`, { ...context, stack });
    },
  };
}

export const logger = {
  api: createLogger("API"),
  chat: createLogger("Chat"),
  channels: createLogger("Channels"),
  telegram: createLogger("Telegram"),
  discord: createLogger("Discord"),
  slack: createLogger("Slack"),
  signal: createLogger("Signal"),
  whatsapp: createLogger("WhatsApp"),
  imessage: createLogger("iMessage"),
  security: createLogger("Security"),
  agent: createLogger("Agent"),
  provider: createLogger("Provider"),
  tools: createLogger("Tools"),
  browser: createLogger("Browser"),
  mcp: createLogger("MCP"),
  skills: createLogger("Skills"),
  lsp: createLogger("LSP"),
  db: createLogger("Database"),
  session: createLogger("Session"),
  core: createLogger("Core"),
};

export default logger;
