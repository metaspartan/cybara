import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { join, resolve, relative, isAbsolute } from "path";
import { cybaraDir } from "./paths";

export type ArtifactKind = "task" | "implementation" | "walkthrough" | "notes" | "custom";

export interface ArtifactSummary {
  sessionId: string;
  name: string;
  fileName: string;
  path: string;
  kind: ArtifactKind;
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface ResolvedArtifactPath {
  sessionId: string;
  name: string;
  fileName: string;
  path: string;
}

const ARTIFACTS_ROOT = join(cybaraDir, "artifacts");
const SESSION_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_CONTENT_CHARS = 1_000_000;

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function ensureWithin(basePath: string, targetPath: string): string {
  const normalizedBase = resolve(basePath);
  const normalizedTarget = resolve(targetPath);
  const rel = relative(normalizedBase, normalizedTarget);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return normalizedTarget;
  }
  throw new Error("Validation error: Artifact path escapes artifact directory");
}

function normalizeSessionId(rawSessionId: string): string {
  const value = rawSessionId.trim();
  if (!value) {
    throw new Error("Validation error: sessionId is required");
  }
  if (!SESSION_ID_REGEX.test(value)) {
    throw new Error(
      "Validation error: sessionId must contain only letters, numbers, '.', '_', ':', or '-'"
    );
  }
  return value;
}

function normalizeArtifactBaseName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new Error("Validation error: artifact name is required");
  }
  const withoutSuffix = trimmed.replace(/\.md\.resolved$/i, "");
  const slug = withoutSuffix
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!slug) {
    throw new Error("Validation error: artifact name must include at least one letter or number");
  }
  return slug;
}

function buildFileName(baseName: string): string {
  return `${baseName}.md.resolved`;
}

function resolveSessionArtifactsDir(sessionId: string): string {
  const normalizedSessionId = normalizeSessionId(sessionId);
  ensureDir(ARTIFACTS_ROOT);
  const sessionDir = join(ARTIFACTS_ROOT, normalizedSessionId);
  return ensureWithin(ARTIFACTS_ROOT, sessionDir);
}

function inferKind(name: string): ArtifactKind {
  if (name === "task" || name.startsWith("task-")) return "task";
  if (name === "implementation" || name.startsWith("implementation-")) return "implementation";
  if (name === "walkthrough" || name.startsWith("walkthrough-")) return "walkthrough";
  if (name === "notes" || name.startsWith("notes-")) return "notes";
  return "custom";
}

function humanizeName(name: string): string {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseTitleFromContent(content: string, fallbackName: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines.slice(0, 30)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim() || humanizeName(fallbackName);
    }
  }
  return humanizeName(fallbackName);
}

function chooseBaseName(kind: ArtifactKind, explicitName?: string): string {
  if (explicitName && explicitName.trim().length > 0) {
    return normalizeArtifactBaseName(explicitName);
  }
  if (kind === "task") return "task";
  if (kind === "implementation") return "implementation";
  if (kind === "walkthrough") return "walkthrough";
  if (kind === "notes") return "notes";
  return "artifact";
}

function resolveArtifactPath(sessionId: string, artifactName: string): ResolvedArtifactPath {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const baseName = normalizeArtifactBaseName(artifactName);
  const fileName = buildFileName(baseName);
  const sessionDir = resolveSessionArtifactsDir(normalizedSessionId);
  const fullPath = ensureWithin(sessionDir, join(sessionDir, fileName));
  return {
    sessionId: normalizedSessionId,
    name: baseName,
    fileName,
    path: fullPath,
  };
}

function resolveAvailableCreatePath(
  sessionId: string,
  baseName: string,
  overwrite?: boolean
): ResolvedArtifactPath {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedBaseName = normalizeArtifactBaseName(baseName);
  const sessionDir = resolveSessionArtifactsDir(normalizedSessionId);
  ensureDir(sessionDir);

  if (overwrite) {
    return resolveArtifactPath(normalizedSessionId, normalizedBaseName);
  }

  let candidateBase = normalizedBaseName;
  let suffix = 2;
  let candidate = resolveArtifactPath(normalizedSessionId, candidateBase);
  while (existsSync(candidate.path)) {
    candidateBase = `${normalizedBaseName}-${suffix}`;
    suffix += 1;
    candidate = resolveArtifactPath(normalizedSessionId, candidateBase);
  }
  return candidate;
}

function summarizeArtifact(sessionId: string, fileName: string): ArtifactSummary | null {
  if (!fileName.endsWith(".md.resolved")) return null;
  const name = fileName.slice(0, -".md.resolved".length);
  const resolvedPath = resolveArtifactPath(sessionId, name);
  if (!existsSync(resolvedPath.path)) return null;

  const stats = statSync(resolvedPath.path);
  const rawContent = readFileSync(resolvedPath.path, "utf8");

  return {
    sessionId: resolvedPath.sessionId,
    name: resolvedPath.name,
    fileName: resolvedPath.fileName,
    path: resolvedPath.path,
    kind: inferKind(resolvedPath.name),
    title: parseTitleFromContent(rawContent, resolvedPath.name),
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function buildArtifactTemplate(input: {
  sessionId: string;
  kind: ArtifactKind;
  title?: string;
  items?: string[];
  now?: Date;
}): string {
  const now = input.now || new Date();
  const iso = now.toISOString();
  const title = input.title?.trim() || humanizeName(chooseBaseName(input.kind));

  if (input.kind === "task") {
    const checklistItems =
      input.items && input.items.length > 0
        ? input.items.map((item) => `- [ ] ${item.trim()}`).join("\n")
        : [
            "- [ ] Clarify requirements",
            "- [ ] Plan implementation",
            "- [ ] Implement changes",
            "- [ ] Run checks and tests",
            "- [ ] Summarize outcome",
          ].join("\n");
    return `# ${title}\n\n${checklistItems}\n\n---\nSession: ${input.sessionId}\nUpdated: ${iso}\n`;
  }

  if (input.kind === "implementation") {
    return `# ${title}\n\n## Goal\n\n## Constraints\n\n## Plan\n\n## Changes\n\n## Verification\n\n---\nSession: ${input.sessionId}\nUpdated: ${iso}\n`;
  }

  if (input.kind === "walkthrough") {
    return `# ${title}\n\n## Context\n\n## Steps\n\n1. \n2. \n3. \n\n## Notes\n\n## Follow-up\n\n---\nSession: ${input.sessionId}\nUpdated: ${iso}\n`;
  }

  return `# ${title}\n\n---\nSession: ${input.sessionId}\nUpdated: ${iso}\n`;
}

export function listArtifacts(sessionId: string): ArtifactSummary[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const sessionDir = resolveSessionArtifactsDir(normalizedSessionId);
  if (!existsSync(sessionDir)) return [];

  const entries = readdirSync(sessionDir, { withFileTypes: true });
  const summaries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md.resolved"))
    .map((entry) => summarizeArtifact(normalizedSessionId, entry.name))
    .filter((summary): summary is ArtifactSummary => summary !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return summaries;
}

export function readArtifact(input: { sessionId: string; name: string; maxChars?: number }): {
  artifact: ArtifactSummary;
  content: string;
  truncated: boolean;
  totalChars: number;
} {
  const resolved = resolveArtifactPath(input.sessionId, input.name);
  if (!existsSync(resolved.path)) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }

  const summary = summarizeArtifact(resolved.sessionId, resolved.fileName);
  if (!summary) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }

  const rawContent = readFileSync(resolved.path, "utf8");
  const requestedMaxChars =
    typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
      ? Math.max(0, Math.floor(input.maxChars))
      : undefined;
  const maxChars =
    requestedMaxChars !== undefined ? Math.min(requestedMaxChars, MAX_CONTENT_CHARS) : undefined;
  const truncated = maxChars !== undefined && rawContent.length > maxChars;
  const content = truncated ? rawContent.slice(0, maxChars) : rawContent;

  return {
    artifact: summary,
    content,
    truncated,
    totalChars: rawContent.length,
  };
}

export function createArtifact(input: {
  sessionId: string;
  kind?: ArtifactKind;
  name?: string;
  title?: string;
  content?: string;
  items?: string[];
  overwrite?: boolean;
}): {
  artifact: ArtifactSummary;
  created: boolean;
} {
  const kind = input.kind || "custom";
  const normalizedSessionId = normalizeSessionId(input.sessionId);
  const baseName = chooseBaseName(kind, input.name);
  const resolved = resolveAvailableCreatePath(normalizedSessionId, baseName, input.overwrite);
  const sessionDir = resolveSessionArtifactsDir(normalizedSessionId);
  ensureDir(sessionDir);

  const content =
    typeof input.content === "string" && input.content.trim().length > 0
      ? input.content
      : buildArtifactTemplate({
          sessionId: normalizedSessionId,
          kind,
          title: input.title,
          items: input.items,
        });

  writeFileSync(resolved.path, content, "utf8");
  const summary = summarizeArtifact(normalizedSessionId, resolved.fileName);
  if (!summary) {
    throw new Error("Failed to create artifact");
  }
  return {
    artifact: summary,
    created: true,
  };
}

export function updateArtifact(input: { sessionId: string; name: string; content: string }): {
  artifact: ArtifactSummary;
  updated: boolean;
} {
  if (typeof input.content !== "string") {
    throw new Error("Validation error: content is required");
  }
  const resolved = resolveArtifactPath(input.sessionId, input.name);
  if (!existsSync(resolved.path)) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }
  writeFileSync(resolved.path, input.content, "utf8");
  const summary = summarizeArtifact(resolved.sessionId, resolved.fileName);
  if (!summary) {
    throw new Error("Failed to update artifact");
  }
  return {
    artifact: summary,
    updated: true,
  };
}

export function appendArtifact(input: { sessionId: string; name: string; content: string }): {
  artifact: ArtifactSummary;
  appended: boolean;
} {
  if (typeof input.content !== "string" || input.content.length === 0) {
    throw new Error("Validation error: content is required");
  }
  const resolved = resolveArtifactPath(input.sessionId, input.name);
  if (!existsSync(resolved.path)) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }
  const existing = readFileSync(resolved.path, "utf8");
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const next = `${existing}${separator}${input.content}`;
  writeFileSync(resolved.path, next, "utf8");
  const summary = summarizeArtifact(resolved.sessionId, resolved.fileName);
  if (!summary) {
    throw new Error("Failed to append artifact");
  }
  return {
    artifact: summary,
    appended: true,
  };
}

export function checkArtifactItem(input: {
  sessionId: string;
  name: string;
  item: number;
  checked?: boolean;
}): {
  artifact: ArtifactSummary;
  updatedLine: number;
  checked: boolean;
} {
  const resolved = resolveArtifactPath(input.sessionId, input.name);
  if (!existsSync(resolved.path)) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }

  const targetIndex = Math.floor(input.item);
  if (!Number.isFinite(targetIndex) || targetIndex < 1) {
    throw new Error("Validation error: item must be a positive checklist index (1-based)");
  }

  const content = readFileSync(resolved.path, "utf8");
  const lines = content.split(/\r?\n/);
  const checklistLineIndexes: number[] = [];
  const checklistRegex = /^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/;
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (checklistRegex.test(lines[idx] || "")) {
      checklistLineIndexes.push(idx);
    }
  }

  if (checklistLineIndexes.length === 0) {
    throw new Error("Validation error: artifact has no checklist items");
  }
  if (targetIndex > checklistLineIndexes.length) {
    throw new Error(
      `Validation error: checklist item ${targetIndex} does not exist (has ${checklistLineIndexes.length} items)`
    );
  }

  const lineIndex = checklistLineIndexes[targetIndex - 1];
  const line = lines[lineIndex] || "";
  const match = line.match(checklistRegex);
  if (!match) {
    throw new Error("Validation error: unable to parse checklist item");
  }

  const markChecked = input.checked !== false;
  lines[lineIndex] = `${match[1]}${markChecked ? "x" : " "}${match[3]}`;
  writeFileSync(resolved.path, lines.join("\n"), "utf8");

  const summary = summarizeArtifact(resolved.sessionId, resolved.fileName);
  if (!summary) {
    throw new Error("Failed to update artifact checklist item");
  }

  return {
    artifact: summary,
    updatedLine: lineIndex + 1,
    checked: markChecked,
  };
}

export function deleteArtifact(input: { sessionId: string; name: string }): {
  deleted: boolean;
  sessionId: string;
  fileName: string;
  name: string;
} {
  const resolved = resolveArtifactPath(input.sessionId, input.name);
  if (!existsSync(resolved.path)) {
    throw new Error(`Artifact not found: ${resolved.fileName}`);
  }
  unlinkSync(resolved.path);
  return {
    deleted: true,
    sessionId: resolved.sessionId,
    fileName: resolved.fileName,
    name: resolved.name,
  };
}
