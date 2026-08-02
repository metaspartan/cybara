import { createHash } from "crypto";
import { existsSync, lstatSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import type { ChatMessage } from "../api/chat";
import { parseDataUri, type AgentImage } from "./llm/image-blocks";

export interface OpenCodeMigrationRoots {
  configRoot: string;
  dataRoot: string;
}

export interface OpenCodeSessionSnapshot {
  sourceId: string;
  title: string;
  workspaceDir: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface OpenCodeSessionStore {
  exists(sessionId: string): Promise<boolean>;
  write(sessionId: string, snapshot: OpenCodeSessionSnapshot): Promise<void>;
}

export interface OpenCodeSessionMigrationResult {
  sessionId: string;
  sourceId: string;
  title: string;
  status: "planned" | "migrated" | "conflict" | "skipped" | "error";
  detail: string;
}

interface OpenCodeSessionRow {
  id: string;
  directory: string;
  title: string;
  time_created: number;
  time_updated: number;
}

interface OpenCodeMessageRow {
  id: string;
  time_created: number;
  data: string;
}

interface OpenCodePartRow {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => isDirectory(path));
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [
    ...new Set(
      paths.filter((path): path is string => Boolean(path?.trim())).map((path) => resolve(path))
    ),
  ];
}

function openCodeConfigCandidates(environment: NodeJS.ProcessEnv, userHome: string): string[] {
  return uniquePaths([
    environment.OPENCODE_CONFIG_DIR,
    environment.XDG_CONFIG_HOME ? join(environment.XDG_CONFIG_HOME, "opencode") : undefined,
    environment.APPDATA ? join(environment.APPDATA, "opencode") : undefined,
    environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "opencode") : undefined,
    join(userHome, ".config", "opencode"),
  ]);
}

function openCodeDataCandidates(environment: NodeJS.ProcessEnv, userHome: string): string[] {
  return uniquePaths([
    environment.XDG_DATA_HOME ? join(environment.XDG_DATA_HOME, "opencode") : undefined,
    environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "opencode") : undefined,
    environment.APPDATA ? join(environment.APPDATA, "opencode") : undefined,
    join(userHome, ".local", "share", "opencode"),
  ]);
}

function hasConfigSignals(root: string): boolean {
  return (
    isFile(join(root, "opencode.json")) ||
    isFile(join(root, "opencode.jsonc")) ||
    isDirectory(join(root, "skills")) ||
    isDirectory(join(root, "commands")) ||
    isDirectory(join(root, "agents"))
  );
}

function hasDataSignals(root: string): boolean {
  return isFile(join(root, "opencode.db")) || isDirectory(join(root, "storage", "session"));
}

export function openCodeDefaultSourcePaths(
  environment: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir()
): string[] {
  const configCandidates = openCodeConfigCandidates(environment, userHome);
  const dataCandidates = openCodeDataCandidates(environment, userHome);
  return [
    firstExisting(configCandidates) || firstExisting(dataCandidates) || configCandidates[0],
  ].filter((path): path is string => Boolean(path));
}

export function resolveOpenCodeMigrationRoots(
  sourcePath: string,
  environment: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir()
): OpenCodeMigrationRoots {
  const sourceRoot = resolve(sourcePath);
  const configCandidates = openCodeConfigCandidates(environment, userHome);
  const dataCandidates = openCodeDataCandidates(environment, userHome);
  const sourceHasConfig = hasConfigSignals(sourceRoot);
  const sourceHasData = hasDataSignals(sourceRoot);
  const configRoot = sourceHasConfig
    ? sourceRoot
    : firstExisting(configCandidates) || (sourceHasData ? sourceRoot : configCandidates[0]);
  const dataRoot = sourceHasData
    ? sourceRoot
    : firstExisting(dataCandidates) || (sourceHasConfig ? sourceRoot : dataCandidates[0]);
  return {
    configRoot: resolve(configRoot || sourceRoot),
    dataRoot: resolve(dataRoot || sourceRoot),
  };
}

export function isOpenCodeMigrationSourceAvailable(sourcePath: string): boolean {
  const roots = resolveOpenCodeMigrationRoots(sourcePath);
  return hasConfigSignals(roots.configRoot) || hasDataSignals(roots.dataRoot);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTimestamp(record: Record<string, unknown>, fallback: number): number {
  const time = asRecord(record.time);
  const value = time.created;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function messageTimestamp(value: number): string {
  return new Date(Math.max(0, value)).toISOString();
}

function toolCallFromPart(
  part: Record<string, unknown>,
  fallbackId: string
): NonNullable<ChatMessage["tool_calls"]>[number] | null {
  if (part.type !== "tool") return null;
  const state = asRecord(part.state);
  const rawStatus = readString(state, "status") || "pending";
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "error" || rawStatus === "failed"
        ? "failed"
        : rawStatus === "running"
          ? "executing"
          : "pending";
  const input = asRecord(state.input);
  const time = asRecord(state.time);
  const startedAt = typeof time.start === "number" ? time.start : undefined;
  const endedAt = typeof time.end === "number" ? time.end : undefined;
  const output = state.output;
  const error = readString(state, "error");
  return {
    id: readString(part, "callID") || fallbackId,
    name: readString(part, "tool") || "tool",
    args: input,
    status,
    result: output,
    error,
    duration:
      startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
        ? endedAt - startedAt
        : undefined,
  };
}

function attachmentLabel(part: Record<string, unknown>): string | null {
  if (part.type !== "file") return null;
  const filename = readString(part, "filename");
  const url = readString(part, "url");
  let urlLabel: string | undefined;
  if (url && !url.startsWith("data:")) {
    try {
      urlLabel = basename(new URL(url).pathname);
    } catch {
      urlLabel = basename(url);
    }
  }
  const label = (filename || urlLabel || "file").slice(0, 240);
  return label ? `[Attachment: ${label}]` : null;
}

function imageFromPart(part: Record<string, unknown>): AgentImage | null {
  if (part.type !== "file") return null;
  const mimeType = readString(part, "mediaType") || readString(part, "mime");
  const url = readString(part, "url");
  if (!mimeType?.startsWith("image/") || !url) return null;
  if (url.startsWith("data:")) {
    const parsed = parseDataUri(url);
    return { data: parsed.data, mimeType: parsed.mimeType || mimeType };
  }
  if (/^https?:\/\//i.test(url)) return { url, mimeType };
  try {
    const path = url.startsWith("file:") ? fileURLToPath(url) : url;
    return isAbsolute(path) ? { path, mimeType } : null;
  } catch {
    return null;
  }
}

function openCodeMessage(row: OpenCodeMessageRow, parts: OpenCodePartRow[]): ChatMessage | null {
  const data = parseJsonRecord(row.data);
  const role = data.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const parsedParts = parts.map((part) => ({ row: part, data: parseJsonRecord(part.data) }));
  const content = parsedParts
    .flatMap(({ data: part }) => {
      if (part.type === "text") {
        const text = readString(part, "text");
        return text ? [text] : [];
      }
      const attachment = attachmentLabel(part);
      return attachment ? [attachment] : [];
    })
    .join("\n\n")
    .trim();
  const thinking = parsedParts
    .flatMap(({ data: part }) => {
      if (part.type !== "reasoning") return [];
      const text = readString(part, "text");
      return text ? [text] : [];
    })
    .join("\n\n")
    .trim();
  const toolCalls = parsedParts.flatMap(({ row: partRow, data: part }) => {
    const toolCall = toolCallFromPart(part, partRow.id);
    return toolCall ? [toolCall] : [];
  });
  const images = parsedParts.flatMap(({ data: part }) => {
    const image = imageFromPart(part);
    return image ? [image] : [];
  });
  if (!content && !thinking && toolCalls.length === 0) return null;
  const timestamp = messageTimestamp(readTimestamp(data, row.time_created));
  const message: ChatMessage = { role, content, timestamp };
  if (thinking) message.thinking = thinking;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (images.length > 0) message.images = images;
  if (role === "assistant") {
    const provider = readString(data, "providerID");
    const model = readString(data, "modelID");
    if (provider) message.provider = provider;
    if (model) message.model = model;
  }
  return message;
}

function tableExists(database: Database, table: string): boolean {
  const row = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | null;
  return row?.name === table;
}

function readSessionRows(database: Database): OpenCodeSessionRow[] {
  if (!tableExists(database, "session")) return [];
  return database
    .query(
      `SELECT id, directory, title, time_created, time_updated
       FROM session
       ORDER BY time_created ASC, id ASC`
    )
    .all() as OpenCodeSessionRow[];
}

function readSessionMessages(database: Database, sessionId: string): ChatMessage[] {
  if (!tableExists(database, "message") || !tableExists(database, "part")) return [];
  const messages = database
    .query(
      `SELECT id, time_created, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created ASC, id ASC`
    )
    .all(sessionId) as OpenCodeMessageRow[];
  const parts = database
    .query(
      `SELECT id, message_id, time_created, data
       FROM part
       WHERE session_id = ?
       ORDER BY time_created ASC, id ASC`
    )
    .all(sessionId) as OpenCodePartRow[];
  const byMessage = new Map<string, OpenCodePartRow[]>();
  for (const part of parts) {
    const current = byMessage.get(part.message_id) || [];
    current.push(part);
    byMessage.set(part.message_id, current);
  }
  return messages.flatMap((message) => {
    const converted = openCodeMessage(message, byMessage.get(message.id) || []);
    return converted ? [converted] : [];
  });
}

export function readOpenCodeSessions(sourcePath: string): OpenCodeSessionSnapshot[] {
  const roots = resolveOpenCodeMigrationRoots(sourcePath);
  const databasePath = join(roots.dataRoot, "opencode.db");
  if (!isFile(databasePath)) return [];
  const database = new Database(databasePath, { readonly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    return readSessionRows(database).flatMap((session) => {
      const messages = readSessionMessages(database, session.id);
      if (messages.length === 0) return [];
      return [
        {
          sourceId: session.id,
          title: session.title?.trim() || "Imported OpenCode chat",
          workspaceDir: isDirectory(session.directory) ? resolve(session.directory) : null,
          createdAt: session.time_created,
          updatedAt: session.time_updated,
          messages,
        },
      ];
    });
  } finally {
    database.close();
  }
}

export function countOpenCodeSessions(sourcePath: string): number {
  const roots = resolveOpenCodeMigrationRoots(sourcePath);
  const databasePath = join(roots.dataRoot, "opencode.db");
  if (!isFile(databasePath)) return 0;
  const database = new Database(databasePath, { readonly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    if (!tableExists(database, "session")) return 0;
    const row = database.query("SELECT COUNT(*) AS count FROM session").get() as {
      count?: number;
    } | null;
    return typeof row?.count === "number" ? row.count : 0;
  } finally {
    database.close();
  }
}

function targetSessionId(sourceId: string): string {
  const hash = createHash("sha256").update(sourceId).digest("hex").slice(0, 24);
  return `migration-opencode-${hash}`;
}

export async function migrateOpenCodeSessions(
  snapshots: OpenCodeSessionSnapshot[],
  options: {
    dryRun: boolean;
    overwrite: boolean;
    store: OpenCodeSessionStore;
  }
): Promise<OpenCodeSessionMigrationResult[]> {
  const store = options.store;
  const results: OpenCodeSessionMigrationResult[] = [];
  for (const snapshot of snapshots) {
    const sessionId = targetSessionId(snapshot.sourceId);
    const exists = await store.exists(sessionId);
    if (exists && !options.overwrite) {
      results.push({
        sessionId,
        sourceId: snapshot.sourceId,
        title: snapshot.title,
        status: options.dryRun ? "planned" : "conflict",
        detail: "Chat was already imported; enable overwrite to replace it",
      });
      continue;
    }
    if (options.dryRun) {
      results.push({
        sessionId,
        sourceId: snapshot.sourceId,
        title: snapshot.title,
        status: "planned",
        detail: `${snapshot.messages.length} messages will be imported`,
      });
      continue;
    }
    try {
      await store.write(sessionId, snapshot);
      results.push({
        sessionId,
        sourceId: snapshot.sourceId,
        title: snapshot.title,
        status: "migrated",
        detail: `${snapshot.messages.length} messages imported`,
      });
    } catch (error) {
      results.push({
        sessionId,
        sourceId: snapshot.sourceId,
        title: snapshot.title,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
