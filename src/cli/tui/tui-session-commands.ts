import type { TUIFetchAPI } from "./components/chat";

export type TuiSessionNotice = {
  handled: boolean;
  notice?: string;
  sessionId?: string;
};

export type TuiRewindMessage = {
  content: string;
  role: string;
  timestamp?: string;
};

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberField(source: Record_, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

function stringField(source: Record_, keys: string[]): string {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

export function readForkSessionId(response: unknown): string {
  if (!isRecord(response)) return "";
  const fork = response.fork;
  if (isRecord(fork)) {
    const nested = stringField(fork, ["sessionId", "session_id", "id"]);
    if (nested) return nested;
  }
  return stringField(response, ["sessionId", "session_id", "id"]);
}

function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

export function parseTurnIndex(argument: string): number | null {
  const trimmed = argument.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return value >= 1 ? value : null;
}

export function countTuiTurns(turns: TuiRewindMessage[]): number {
  return turns.filter((turn) => turn.role === "user").length;
}

export function resolveRewindTarget(
  turns: TuiRewindMessage[],
  turnIndex: number
): { index: number; message: TuiRewindMessage } | null {
  if (turnIndex < 1) return null;
  const userIndexes = turns
    .map((turn, index) => ({ turn, index }))
    .filter((entry) => entry.turn.role === "user")
    .map((entry) => entry.index);
  const target = userIndexes[userIndexes.length - turnIndex];
  if (target === undefined) return null;
  const message = turns[target];
  if (!message) return null;
  return { index: target, message };
}

export function revertRequestBody(target: { index: number; message: TuiRewindMessage }): Record_ {
  const body: Record_ = {
    messageIndex: target.index,
    messageRole: target.message.role,
  };
  if (target.message.content) body.messageContent = target.message.content;
  if (target.message.timestamp) body.messageTimestamp = target.message.timestamp;
  return body;
}

export function forkRequestBody(target: { index: number } | null, title?: string): Record_ {
  const body: Record_ = {};
  if (target) body.throughMessageIndex = target.index;
  const trimmedTitle = title?.trim();
  if (trimmedTitle) body.title = trimmedTitle;
  return body;
}

export function healthNotice(payload: unknown): string {
  if (!isRecord(payload)) return "Gateway health returned an unreadable response.";
  const status = stringField(payload, ["status"]) || "unknown";
  const version = stringField(payload, ["version"]);
  const uptimeRaw = numberField(payload, ["uptime", "uptimeSeconds"]);
  const uptime =
    uptimeRaw === undefined
      ? "unknown"
      : uptimeRaw >= 3600
        ? `${(uptimeRaw / 3600).toFixed(1)}h`
        : uptimeRaw >= 60
          ? `${Math.round(uptimeRaw / 60)}m`
          : `${Math.round(uptimeRaw)}s`;
  const lines = [`Gateway status: ${status}`, `Uptime: ${uptime}`];
  if (version) lines.push(`Version: ${version}`);
  const checks = payload.checks;
  if (isRecord(checks)) {
    for (const [name, check] of Object.entries(checks)) {
      if (!isRecord(check)) continue;
      const checkStatus = stringField(check, ["status"]) || "unknown";
      const running = numberField(check, ["running"]);
      const detail = running === undefined ? "" : ` (${running} running)`;
      lines.push(`  ${name}: ${checkStatus}${detail}`);
    }
  }
  return lines.join("\n");
}

export function doctorNotice(payload: unknown): string {
  if (!isRecord(payload)) return "Doctor returned an unreadable response.";
  const ready = payload.ready === true;
  const source = stringField(payload, ["driverSource"]);
  const driverVersion = stringField(payload, ["version"]);
  const message = stringField(payload, ["message"]);
  const lines = [`Computer use: ${ready ? "ready" : "not ready"}`];
  if (driverVersion) lines.push(`  driver: ${driverVersion}${source ? ` (${source})` : ""}`);
  if (message) lines.push(`  ${message}`);
  const checks = payload.checks;
  if (isRecord(checks)) {
    for (const [name, check] of Object.entries(checks)) {
      if (!isRecord(check)) continue;
      const checkStatus = stringField(check, ["status"]) || "unknown";
      const detail = stringField(check, ["message"]);
      lines.push(`  ${name}: ${checkStatus}${detail ? ` — ${detail}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function costNotice(usage: unknown, sessionLabel: string): string {
  if (!isRecord(usage)) return "No token usage recorded for this session yet.";
  const input = numberField(usage, ["inputTokens"]) ?? 0;
  const output = numberField(usage, ["outputTokens"]) ?? 0;
  const total = numberField(usage, ["totalTokens"]) ?? input + output;
  const cached = numberField(usage, ["cachedInputTokens"]) ?? 0;
  const cacheWrite = numberField(usage, ["cacheWriteTokens"]) ?? 0;
  const calls = numberField(usage, ["callCount"]) ?? 0;
  const firstToken = numberField(usage, ["firstTokenMs"]);
  const lines = [
    `Tokens for ${sessionLabel}`,
    `  Input: ${formatCount(input)}${cached > 0 ? ` (${formatCount(cached)} cached)` : ""}`,
    `  Output: ${formatCount(output)}`,
    `  Total: ${formatCount(total)} across ${calls} call${calls === 1 ? "" : "s"}`,
  ];
  if (cacheWrite > 0) lines.push(`  Cache write: ${formatCount(cacheWrite)}`);
  if (firstToken !== undefined) {
    lines.push(
      `  First token: ${firstToken < 1000 ? `${Math.round(firstToken)}ms` : `${(firstToken / 1000).toFixed(1)}s`}`
    );
  }
  if (total > 0)
    lines.push("  Provider cost is billed by the model; check your provider dashboard.");
  return lines.join("\n");
}

export function keybindNotice(commands: ReadonlyArray<{ detail: string; name: string }>): string {
  const keys = [
    "Enter send · Shift+Enter newline · Ctrl+C clear input, again exit",
    "Up/Down history · Tab complete command · Up in empty input walks commands",
    "Ctrl+D exit · PgUp/PgUp and PgDn scroll transcript · Mouse wheel scroll",
    "Ctrl+U clear line · Ctrl+W delete word · Ctrl+A/E line start/end",
  ];
  const lines = [
    "Key bindings",
    ...keys.map((line) => `  ${line}`),
    "",
    `Commands (${commands.length})`,
  ];
  for (const command of commands) lines.push(`  ${command.name.padEnd(14)} ${command.detail}`);
  return lines.join("\n");
}

export function themeNotice(current: string, requested: string | null): string {
  if (requested === null) return `Terminal theme: ${current}. Usage: /theme [dark|light]`;
  return `Terminal theme set to ${requested}. Restart the TUI to apply it.`;
}

export function backupNotice(payload: unknown): string {
  if (!isRecord(payload)) return "No checkpoints found.";
  const raw = Array.isArray(payload.backups) ? payload.backups : [];
  if (raw.length === 0) return "No checkpoints found.";
  const lines = [`Checkpoints (${raw.length})`];
  for (const entry of raw.slice(0, 10)) {
    if (!isRecord(entry)) continue;
    const label = stringField(entry, ["label", "name", "id"]) || "checkpoint";
    const created = stringField(entry, ["createdAt", "created_at", "timestamp"]);
    lines.push(`  ${label}${created ? ` — ${created}` : ""}`);
  }
  if (raw.length > 10) lines.push(`  …and ${raw.length - 10} more`);
  return lines.join("\n");
}

export async function runTuiSessionCommand(options: {
  argument: string;
  command: string;
  fetchAPI: TUIFetchAPI;
  localSessionId: string;
  messages: TuiRewindMessage[];
  commands: ReadonlyArray<{ detail: string; name: string }>;
  theme: string;
}): Promise<TuiSessionNotice> {
  const { argument, command, fetchAPI, localSessionId, messages, commands, theme } = options;
  const trimmedArgument = argument.trim();
  const sessionLabel = localSessionId || "this session";

  if (command === "keybinds") {
    return { handled: true, notice: keybindNotice(commands) };
  }
  if (command === "theme") {
    const requested = trimmedArgument ? trimmedArgument.toLowerCase() : null;
    if (requested && requested !== "dark" && requested !== "light") {
      return { handled: true, notice: "Usage: /theme [dark|light]" };
    }
    return { handled: true, notice: themeNotice(theme, requested) };
  }
  if (command === "health") {
    return { handled: true, notice: healthNotice(await fetchAPI("/api/health")) };
  }
  if (command === "doctor") {
    return { handled: true, notice: doctorNotice(await fetchAPI("/api/computer-use/status")) };
  }
  if (command === "cost") {
    if (!localSessionId) return { handled: true, notice: "No active session." };
    const detail = await fetchAPI(`/api/chat/sessions/${encodeURIComponent(localSessionId)}`);
    return {
      handled: true,
      notice: costNotice(isRecord(detail) ? detail.tokenUsage : null, sessionLabel),
    };
  }
  if (command === "checkpoint") {
    return { handled: true, notice: backupNotice(await fetchAPI("/api/system/backups")) };
  }

  const isFork = command === "fork";
  if (command !== "undo" && command !== "rewind" && !isFork) return { handled: false };
  if (!localSessionId) return { handled: true, notice: "No active session." };
  const turnCount = countTuiTurns(messages);
  if (!turnCount) return { handled: true, notice: "No turns to act on yet." };

  const requested = parseTurnIndex(trimmedArgument);
  if (trimmedArgument && requested === null) {
    return { handled: true, notice: `Usage: /${command} <turn number>` };
  }
  const turnIndex = requested ?? 1;
  if (turnIndex > turnCount) {
    return {
      handled: true,
      notice: `Turn ${turnIndex} does not exist. This session has ${turnCount}.`,
    };
  }
  const target = resolveRewindTarget(messages, turnIndex);
  if (!target) return { handled: true, notice: "Could not resolve that turn." };

  if (isFork) {
    const response = await fetchAPI(`/api/sessions/${encodeURIComponent(localSessionId)}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forkRequestBody(target)),
    });
    const forkId = readForkSessionId(response);
    if (!forkId) return { handled: true, notice: "Fork failed." };
    return {
      handled: true,
      sessionId: forkId,
      notice: `Forked ${turnIndex} turn${turnIndex === 1 ? "" : "s"} into a new session. Use /resume to pick it.`,
    };
  }

  const response = await fetchAPI(`/api/sessions/${encodeURIComponent(localSessionId)}/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(revertRequestBody(target)),
  });
  if (isRecord(response) && response.success === false) {
    return { handled: true, notice: stringField(response, ["error"]) || "Undo failed." };
  }
  return {
    handled: true,
    notice: `Rewound to before turn ${turnIndex}. Earlier turns are kept in the session history.`,
  };
}
