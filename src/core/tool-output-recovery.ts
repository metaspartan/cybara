import { createHash } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { cybaraDir } from "./paths";

export const TOOL_OUTPUT_RECOVERY_DIR = join(cybaraDir, "tool-results");

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

export interface ToolOutputRecoveryOptions {
  sessionId?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface RecoverableToolOutputPreview {
  content: string;
  truncated: boolean;
  outputPath?: string;
}

function segment(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback).replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 96);
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true });
  try {
    chmodSync(path, 0o700);
  } catch {}
}

function cleanupOldOutputs(now = Date.now()): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  if (!existsSync(TOOL_OUTPUT_RECOVERY_DIR)) return;
  for (const sessionEntry of readdirSync(TOOL_OUTPUT_RECOVERY_DIR, { withFileTypes: true })) {
    if (!sessionEntry.isDirectory()) continue;
    const sessionDir = join(TOOL_OUTPUT_RECOVERY_DIR, sessionEntry.name);
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(sessionDir, entry.name);
      try {
        if (now - statSync(path).mtimeMs > RETENTION_MS) {
          rmSync(path, { force: true });
        }
      } catch {}
    }
  }
}

export function persistToolOutputForRecovery(input: {
  content: string;
  sessionId?: string;
  toolName?: string;
  toolCallId?: string;
  now?: Date;
}): string | undefined {
  try {
    cleanupOldOutputs(input.now?.getTime());
    const session = segment(input.sessionId, "global");
    const tool = segment(input.toolName, "tool");
    const call = segment(input.toolCallId, "call");
    const sessionDir = join(TOOL_OUTPUT_RECOVERY_DIR, session);
    ensurePrivateDir(TOOL_OUTPUT_RECOVERY_DIR);
    ensurePrivateDir(sessionDir);
    const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const hash = createHash("sha256").update(input.content).digest("hex").slice(0, 12);
    const path = join(sessionDir, `${timestamp}-${tool}-${call}-${hash}.txt`);
    writeFileSync(path, input.content, "utf8");
    try {
      chmodSync(path, 0o600);
    } catch {}
    return path;
  } catch {
    return undefined;
  }
}

export function formatRecoverableToolOutputPreview(
  content: string,
  maxChars: number,
  options: ToolOutputRecoveryOptions = {}
): RecoverableToolOutputPreview {
  const normalized = content.replace(/\u0000/g, "").trim();
  if (normalized.length <= maxChars) {
    return { content: normalized, truncated: false };
  }

  const outputPath = persistToolOutputForRecovery({
    content,
    sessionId: options.sessionId,
    toolName: options.toolName,
    toolCallId: options.toolCallId,
  });
  const recoveryHint = outputPath
    ? `Full output saved to: ${outputPath}\nTo recover omitted details, use the read tool with offset/limit on that file, or grep/search it first. Do not read the whole file unless the full output is needed.`
    : "Full output remains stored in the chat transcript, but Cybara could not write a recovery cache file.";
  const marker = `\n[truncated: omitted ${normalized.length} chars from the middle]\n${recoveryHint}\n`;
  const budget = Math.max(64, maxChars - marker.length);
  const headChars = Math.max(16, Math.floor(budget * 0.68));
  const tailChars = Math.max(16, budget - headChars);
  const omitted = Math.max(1, normalized.length - headChars - tailChars);
  return {
    content: `${normalized.slice(0, headChars)}\n[truncated: omitted ${omitted} chars from the middle]\n${recoveryHint}\n${normalized.slice(-tailChars)}`,
    truncated: true,
    outputPath,
  };
}
