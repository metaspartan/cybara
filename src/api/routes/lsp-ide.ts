import { dirname, isAbsolute, resolve } from "path";
import { getLSPManager, initLSPManager } from "../../core/lsp";
import { trackMetric } from "../../core/metrics";
import type { LspLocationLike, LspSymbolLike, NormalizedLspSymbol } from "./_shared";

export function resolveWorkspacePath(filePath?: string): string {
  if (!filePath || typeof filePath !== "string") {
    return process.cwd();
  }

  const trimmed = filePath.trim();
  if (!trimmed) return process.cwd();

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  return dirname(absolute);
}

export function getOrInitLspManager(workspacePath?: string) {
  const resolvedWorkspace = workspacePath ? resolve(workspacePath) : resolve(process.cwd());
  try {
    const existing = getLSPManager();
    if (resolve(existing.getWorkspacePath()) !== resolvedWorkspace) {
      return initLSPManager(resolvedWorkspace);
    }
    return existing;
  } catch {
    return initLSPManager(resolvedWorkspace);
  }
}

export function trackLspOperation(
  operation: string,
  metadata?: Record<string, unknown>,
  value = 1
): void {
  trackMetric("lsp_operation", operation, value, metadata);
}

export function trackIdeOperation(
  operation:
    | "browse"
    | "read"
    | "write"
    | "create"
    | "rename"
    | "search"
    | "blame"
    | "reveal"
    | "open_terminal"
    | "permalink"
    | "history_url"
    | "replace"
    | "replace_preview"
    | "list_files"
    | "index_status"
    | "index_workspace"
    | "index_reindex"
    | "index_stop"
    | "index_search"
    | "index_settings"
    | "index_embeddings"
    | "index_embedding_runtime"
    | "index_embedding_load"
    | "index_embedding_stop"
    | "inline_completion",
  path: string | undefined,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  trackMetric("ide_operation", operation, 1, { path, success, ...metadata });
}

export function stripInlineCompletionFormatting(value: string): string {
  const withoutThinking = value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "");
  const withoutCodeFences = withoutThinking
    .replace(/^```[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/```$/g, "");
  return withoutCodeFences.trim();
}

export function sanitizeInlineCompletion(value: string, prefix: string, maxChars = 320): string {
  let next = stripInlineCompletionFormatting(value);
  if (!next) return "";

  if (prefix && next.toLowerCase().startsWith(prefix.toLowerCase())) {
    next = next.slice(prefix.length);
  }

  const maxLength = Math.max(24, Math.min(2000, Math.floor(maxChars)));
  if (next.length > maxLength) {
    next = next.slice(0, maxLength);
  }

  next = next.replace(/^(here(?:'s| is)\s+)?(?:the\s+)?(?:completion|suggestion)\s*[:-]\s*/i, "");
  return next;
}

export function truncateInlineContext(value: string, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

export function normalizeFileUriToPath(uri: string): string {
  if (!uri) return "";

  try {
    const url = new URL(uri);
    if (url.protocol === "file:") {
      let pathname = decodeURIComponent(url.pathname);
      if (process.platform === "win32" && pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }
      return pathname;
    }
  } catch {}

  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.slice("file://".length));
  }
  return uri;
}

export function normalizeDefinitionLocation(
  raw: unknown
): { uri: string; path: string; line: number; character: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const location = raw as LspLocationLike;

  const uri =
    typeof location.uri === "string"
      ? location.uri
      : typeof location.targetUri === "string"
        ? location.targetUri
        : "";
  if (!uri) return null;

  const start =
    location.range?.start || location.targetSelectionRange?.start || location.targetRange?.start;
  const line = typeof start?.line === "number" ? start.line : 0;
  const character = typeof start?.character === "number" ? start.character : 0;

  return {
    uri,
    path: normalizeFileUriToPath(uri),
    line,
    character,
  };
}

export function normalizeSymbolRange(raw: unknown): {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const range = raw as {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  const line = typeof range.start?.line === "number" ? range.start.line : 0;
  const character = typeof range.start?.character === "number" ? range.start.character : 0;
  const endLine = typeof range.end?.line === "number" ? range.end.line : line;
  const endCharacter = typeof range.end?.character === "number" ? range.end.character : character;
  return { line, character, endLine, endCharacter };
}

export function normalizeLspSymbol(raw: unknown): NormalizedLspSymbol | null {
  if (!raw || typeof raw !== "object") return null;
  const symbol = raw as LspSymbolLike;
  const range =
    normalizeSymbolRange(symbol.range) ||
    normalizeSymbolRange(symbol.selectionRange) ||
    normalizeSymbolRange(symbol.location?.range);
  if (!range) return null;

  const children = (Array.isArray(symbol.children) ? symbol.children : [])
    .map((child) => normalizeLspSymbol(child))
    .filter((child): child is NormalizedLspSymbol => !!child);

  return {
    name: typeof symbol.name === "string" && symbol.name.trim() ? symbol.name : "(symbol)",
    kind: typeof symbol.kind === "number" && Number.isFinite(symbol.kind) ? symbol.kind : 13,
    detail: typeof symbol.detail === "string" && symbol.detail.trim() ? symbol.detail : undefined,
    line: range.line + 1,
    character: range.character + 1,
    endLine: range.endLine + 1,
    endCharacter: range.endCharacter + 1,
    children: children.length > 0 ? children : undefined,
  };
}
