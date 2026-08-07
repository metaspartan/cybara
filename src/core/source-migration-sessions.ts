import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { ChatMessage } from "../api/chat";
import type { MigrationSourceKind } from "./source-migration";
import type { OpenCodeSessionSnapshot } from "./source-migration-opencode";

const MAX_SESSIONS_PER_SOURCE = 500;
const MAX_MESSAGES_PER_SESSION = 400;
const MAX_MESSAGE_CHARS = 20000;

export type ImportedSessionSnapshot = OpenCodeSessionSnapshot;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listFilesRecursive(root: string, extension: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const found: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesRecursive(full, extension, depth - 1));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

function readJsonLines(path: string): Record<string, unknown>[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed as Record<string, unknown>);
      }
    } catch {}
  }
  return rows;
}

function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (typeof block === "string") return block;
        if (!block || typeof block !== "object") return "";
        const typed = block as Record<string, unknown>;
        if (typeof typed.text === "string") return typed.text;
        if (typeof typed.content === "string") return typed.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    if (typeof typed.text === "string") return typed.text;
  }
  return "";
}

function pushMessage(messages: ChatMessage[], role: unknown, content: unknown, at?: unknown): void {
  if (messages.length >= MAX_MESSAGES_PER_SESSION) return;
  const normalizedRole = role === "assistant" ? "assistant" : role === "user" ? "user" : undefined;
  if (!normalizedRole) return;
  const text = flattenContent(content).trim();
  if (!text) return;
  messages.push({
    role: normalizedRole,
    content: text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text,
    timestamp: typeof at === "string" && at ? at : new Date().toISOString(),
  } as ChatMessage);
}

function timestampMs(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function deriveTitle(messages: ChatMessage[], fallback: string): string {
  const firstUser = messages.find((message) => message.role === "user");
  const text = (firstUser?.content || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function existingDirectory(path: string | null): string | null {
  if (!path) return null;
  try {
    return statSync(path).isDirectory() ? path : null;
  } catch {
    return null;
  }
}

function snapshotFromFile(
  path: string,
  sourceId: string,
  messages: ChatMessage[],
  workspaceDir: string | null,
  createdAt: number,
  updatedAt: number,
  title: string
): ImportedSessionSnapshot | null {
  if (messages.length === 0) return null;
  return {
    sourceId,
    title: deriveTitle(messages, title),
    workspaceDir: existingDirectory(workspaceDir),
    createdAt,
    updatedAt,
    messages,
  };
}

function readClaudeCodeSession(path: string): ImportedSessionSnapshot | null {
  const rows = readJsonLines(path);
  if (rows.length === 0) return null;
  const messages: ChatMessage[] = [];
  let workspaceDir: string | null = null;
  let aiTitle = "";
  let firstAt = 0;
  let lastAt = 0;

  for (const row of rows) {
    if (typeof row.cwd === "string" && !workspaceDir) workspaceDir = row.cwd;
    if (row.type === "ai-title" && typeof row.aiTitle === "string") aiTitle = row.aiTitle;
    if (row.type !== "user" && row.type !== "assistant") continue;
    const message = row.message as Record<string, unknown> | undefined;
    if (!message) continue;
    const at = timestampMs(row.timestamp, Date.now());
    if (!firstAt) firstAt = at;
    lastAt = at;
    pushMessage(messages, message.role ?? row.type, message.content, row.timestamp);
  }

  return snapshotFromFile(
    path,
    path,
    messages,
    workspaceDir,
    firstAt || Date.now(),
    lastAt || firstAt || Date.now(),
    aiTitle || "Claude Code session"
  );
}

function readCodexSession(path: string): ImportedSessionSnapshot | null {
  const rows = readJsonLines(path);
  if (rows.length === 0) return null;
  const messages: ChatMessage[] = [];
  let workspaceDir: string | null = null;
  let sessionId = "";
  let firstAt = 0;
  let lastAt = 0;

  for (const row of rows) {
    const payload = row.payload as Record<string, unknown> | undefined;
    if (row.type === "session_meta" && payload) {
      if (typeof payload.cwd === "string") workspaceDir = payload.cwd;
      if (typeof payload.id === "string") sessionId = payload.id;
    }
    if (row.type !== "response_item" || !payload) continue;
    if (payload.type !== "message") continue;
    const role = payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const at = timestampMs(row.timestamp, Date.now());
    if (!firstAt) firstAt = at;
    lastAt = at;
    pushMessage(messages, role, payload.content, row.timestamp);
  }

  return snapshotFromFile(
    path,
    sessionId || path,
    messages,
    workspaceDir,
    firstAt || Date.now(),
    lastAt || firstAt || Date.now(),
    "Codex session"
  );
}

function readOpenClawSession(path: string): ImportedSessionSnapshot | null {
  const rows = readJsonLines(path);
  if (rows.length === 0) return null;
  const messages: ChatMessage[] = [];
  let workspaceDir: string | null = null;
  let sessionId = "";
  let firstAt = 0;
  let lastAt = 0;

  for (const row of rows) {
    if (row.type === "session") {
      if (typeof row.cwd === "string") workspaceDir = row.cwd;
      if (typeof row.id === "string") sessionId = row.id;
    }
    if (row.type !== "message") continue;
    const message = row.message as Record<string, unknown> | undefined;
    if (!message) continue;
    const at = timestampMs(row.timestamp, Date.now());
    if (!firstAt) firstAt = at;
    lastAt = at;
    pushMessage(messages, message.role, message.content, row.timestamp);
  }

  return snapshotFromFile(
    path,
    sessionId || path,
    messages,
    workspaceDir,
    firstAt || Date.now(),
    lastAt || firstAt || Date.now(),
    "OpenClaw session"
  );
}

function readHermesSession(path: string): ImportedSessionSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages: ChatMessage[] = [];
  for (const entry of rawMessages) {
    if (!entry || typeof entry !== "object") continue;
    const typed = entry as Record<string, unknown>;
    pushMessage(messages, typed.role, typed.content, typed.timestamp);
  }
  const started = timestampMs(record.session_start, Date.now());
  return snapshotFromFile(
    path,
    typeof record.session_id === "string" ? record.session_id : path,
    messages,
    null,
    started,
    timestampMs(record.last_updated, started),
    "Hermes session"
  );
}

function sessionFilesFor(kind: MigrationSourceKind, root: string): string[] {
  if (kind === "claude-code") return listFilesRecursive(join(root, "projects"), ".jsonl");
  if (kind === "codex") return listFilesRecursive(join(root, "sessions"), ".jsonl");
  if (kind === "openclaw") {
    return listFilesRecursive(join(root, "agents"), ".jsonl").filter(
      (path) => !path.includes(".trajectory") && !path.includes(".deleted")
    );
  }
  if (kind === "hermes") {
    return listFilesRecursive(join(root, "sessions"), ".json").filter((path) =>
      path.includes("session_")
    );
  }
  return [];
}

export function readSourceSessions(
  kind: MigrationSourceKind,
  root: string
): ImportedSessionSnapshot[] {
  const files = sessionFilesFor(kind, root).filter(isFile);
  const snapshots: ImportedSessionSnapshot[] = [];
  for (const path of files) {
    let snapshot: ImportedSessionSnapshot | null = null;
    if (kind === "claude-code") snapshot = readClaudeCodeSession(path);
    else if (kind === "codex") snapshot = readCodexSession(path);
    else if (kind === "openclaw") snapshot = readOpenClawSession(path);
    else if (kind === "hermes") snapshot = readHermesSession(path);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS_PER_SOURCE);
}

export function countSourceSessions(kind: MigrationSourceKind, root: string): number {
  return sessionFilesFor(kind, root).length;
}
