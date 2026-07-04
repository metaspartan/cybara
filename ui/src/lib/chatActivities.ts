export type ActivityPhase = "start" | "result" | "error";

export interface LiveActivityItem {
  id: string;
  phase: ActivityPhase;
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface ToolCallLike {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "executing" | "completed" | "failed" | "success" | "error";
  started_at?: number | string;
  timeline_index?: number;
  duration?: number | string;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeSandboxProvider(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "apple_sandbox" ||
    normalized === "podman" ||
    normalized === "docker" ||
    normalized === "host"
  ) {
    return normalized;
  }
  return undefined;
}

function resolveToolCallSandboxProvider(call: ToolCallLike): string | undefined {
  if (!isObjectRecord(call.result)) return undefined;
  return normalizeSandboxProvider(call.result.sandboxProvider ?? call.result.sandbox_provider);
}

function summarizeToolResult(call: ToolCallLike, phase: ActivityPhase): string | undefined {
  if (phase !== "result") return undefined;
  if (!isObjectRecord(call.result)) return undefined;

  const key = call.name.toLowerCase();
  if (key === "write" || key === "edit") {
    const change = isObjectRecord(call.result.change) ? call.result.change : undefined;
    const path =
      (typeof change?.path === "string" && change.path.trim()) ||
      (typeof call.result.path === "string" && call.result.path.trim()) ||
      "";
    const added = toFiniteNumber(change?.addedLines);
    const removed = toFiniteNumber(change?.removedLines);

    if (path && added !== undefined && removed !== undefined) {
      return `Edited ${toDisplayPath(path)} +${added} -${removed}`;
    }
    if (path) {
      return `Edited ${toDisplayPath(path)}`;
    }
    if (added !== undefined && removed !== undefined) {
      return `Edited file +${added} -${removed}`;
    }
  }

  if (key === "file_search" || key === "grep") {
    const files = Array.isArray(call.result.files) ? call.result.files : undefined;
    const count = toFiniteNumber(call.result.count) || (files ? files.length : undefined);
    if (count !== undefined) {
      const safeCount = Math.max(0, Math.floor(count));
      return `Explored ${safeCount} file${safeCount === 1 ? "" : "s"}, 1 search`;
    }
  }

  return undefined;
}

function toCanonicalVerb(text: string, phase: ActivityPhase): string {
  const trimmed = text.trim();
  if (!trimmed || phase === "start") return trimmed;

  if (phase === "result") {
    return trimmed
      .replace(/^Exploring\b/i, "Explored")
      .replace(/^Searching\b/i, "Searched")
      .replace(/^Fetching\b/i, "Fetched")
      .replace(/^Running\b/i, "Ran")
      .replace(/^Writing\b/i, "Edited")
      .replace(/^Editing\b/i, "Edited");
  }

  return trimmed
    .replace(/^Exploring\b/i, "Read failed")
    .replace(/^Searching\b/i, "Search failed")
    .replace(/^Fetching\b/i, "Fetch failed")
    .replace(/^Running\b/i, "Command failed")
    .replace(/^Writing\b/i, "Edit failed")
    .replace(/^Editing\b/i, "Edit failed");
}

function activityDedupKey(activity: LiveActivityItem): string {
  if (activity.toolCallId) {
    return `toolCall:${activity.toolCallId}:${activity.phase}`;
  }
  const normalizedId = activity.id.trim();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  const timestamp = Number.isFinite(activity.timestamp) ? Math.floor(activity.timestamp) : 0;
  return `${activity.phase}:${toolPrefix}${normalizeText(activity.text).toLowerCase()}:${timestamp}`;
}

function semanticActivityDedupKey(activity: LiveActivityItem): string {
  if (activity.toolCallId) {
    return `toolCall:${activity.toolCallId}:${activity.phase}`;
  }
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  const normalizedText = normalizeText(
    toCanonicalVerb(activity.text, activity.phase)
  ).toLowerCase();
  const timestampBucket = Number.isFinite(activity.timestamp)
    ? Math.floor(activity.timestamp / 1000)
    : 0;
  return `${activity.phase}:${toolPrefix}${normalizedText}:${timestampBucket}`;
}

function canonicalActivityKey(activity: LiveActivityItem): string {
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  return `${toolPrefix}${normalizeText(toCanonicalVerb(activity.text, "result")).toLowerCase()}`;
}

function normalizeToolPhase(status: ToolCallLike["status"]): ActivityPhase {
  if (status === "pending" || status === "executing") return "start";
  if (status === "failed" || status === "error") return "error";
  return "result";
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const REASONING_MARKUP_TOKEN_PATTERN =
  /<\/?(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning|final)\b[^>]*>|\[\/?(?:thinking|reasoning)\]/gi;

/**
 * Remove reasoning tag tokens (e.g. a bare "</think>" streamed as a thought
 * delta) from activity text. Also cleans activities persisted before the
 * gateway started stripping these at the source.
 */
export function stripReasoningTagTokens(text: string): string {
  return text
    .replace(REASONING_MARKUP_TOKEN_PATTERN, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normalizeActivityTextForPhase(text: string, phase: ActivityPhase): string {
  return toCanonicalVerb(text, phase);
}

export function buildActivitiesFromToolCalls(
  toolCalls: ToolCallLike[] | undefined,
  formatToolIntent: (
    toolName: string,
    args: Record<string, unknown>,
    phase: ActivityPhase,
    fallbackDetail?: string
  ) => string,
  options?: {
    baseTimestampMs?: number;
  }
): LiveActivityItem[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  const fallbackBase = Number.isFinite(options?.baseTimestampMs as number)
    ? (options?.baseTimestampMs as number)
    : 0;
  const activities: LiveActivityItem[] = [];

  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    const phase = normalizeToolPhase(call.status);
    const args = (call.arguments || call.args || {}) as Record<string, unknown>;
    const text = summarizeToolResult(call, phase) || formatToolIntent(call.name, args, phase);
    const trimmedText = text.trim();
    if (!trimmedText) continue;

    const startedAt =
      toTimestampMs(call.started_at) ??
      (typeof call.timeline_index === "number" && Number.isFinite(call.timeline_index)
        ? fallbackBase + call.timeline_index
        : fallbackBase + index);

    activities.push({
      id: call.id ? `tool-${call.id}` : `tool-${index}-${call.name}`,
      phase,
      text: trimmedText,
      timestamp: startedAt,
      toolName: call.name,
      toolCallId: call.id,
      sandboxProvider: resolveToolCallSandboxProvider(call),
    });
  }

  return activities;
}

export function mergeActivityLists(
  primary: LiveActivityItem[],
  secondary: LiveActivityItem[]
): LiveActivityItem[] {
  const allActivities = [...primary, ...secondary]
    .map((activity) => {
      const text = stripReasoningTagTokens(activity.text);
      return text === activity.text ? activity : { ...activity, text };
    })
    .filter((activity) => activity.text.length > 0);
  const hasCompletionForStart = (activity: LiveActivityItem): boolean => {
    if (activity.phase !== "start") return false;
    if (activity.toolCallId) {
      return allActivities.some(
        (candidate) =>
          candidate.phase !== "start" &&
          candidate.toolCallId === activity.toolCallId &&
          candidate.timestamp >= activity.timestamp
      );
    }
    const key = canonicalActivityKey(activity);
    const normalizedToolName = activity.toolName?.toLowerCase();
    return allActivities.some((candidate) => {
      if (candidate.phase === "start") return false;
      if (candidate.timestamp < activity.timestamp) return false;
      if (normalizedToolName && candidate.toolName?.toLowerCase() === normalizedToolName)
        return true;
      return canonicalActivityKey(candidate) === key;
    });
  };

  const seen = new Set<string>();
  const seenSemantic = new Set<string>();
  const merged: LiveActivityItem[] = [];

  const pushUnique = (activity: LiveActivityItem) => {
    if (hasCompletionForStart(activity)) {
      return;
    }
    const exactKey = activityDedupKey(activity);
    if (seen.has(exactKey)) return;
    const semanticKey = semanticActivityDedupKey(activity);
    if (seenSemantic.has(semanticKey)) return;
    seen.add(exactKey);
    seenSemantic.add(semanticKey);
    merged.push(activity);
  };

  for (const activity of allActivities) {
    pushUnique(activity);
  }

  return merged;
}

export function finalizeCompletedActivities(activities: LiveActivityItem[]): LiveActivityItem[] {
  const finalized: LiveActivityItem[] = activities.map((activity): LiveActivityItem => {
    if (activity.phase !== "start") {
      return activity;
    }
    return {
      ...activity,
      phase: "result",
      text: normalizeActivityTextForPhase(activity.text, "result"),
    };
  });
  return mergeActivityLists([], finalized);
}

// ── Codex-style display grouping ─────────────────────────────────────────────
// Consecutive completed "exploring" activities (reads / searches / lists)
// collapse into one summary row ("Read 3 files") that expands to the full
// list. Failures and in-flight steps are never grouped, so nothing is hidden.

export type ActivityGroupKind = "read" | "search" | "list";

export interface ActivityDisplayGroup {
  type: "group";
  id: string;
  kind: ActivityGroupKind;
  label: string;
  items: LiveActivityItem[];
}

export interface ActivityDisplaySingle {
  type: "single";
  activity: LiveActivityItem;
}

export type ActivityDisplayEntry = ActivityDisplayGroup | ActivityDisplaySingle;

type GroupableKind = ActivityGroupKind | "command";

const GROUPABLE_TOOL_KINDS: Record<string, GroupableKind> = {
  read: "read",
  grep: "search",
  file_search: "search",
  glob: "search",
  web_search: "search",
  ls: "list",
  list: "list",
};

// Shell verbs that only read/inspect — safe to fold into an exploring group.
// Anything not listed (git commit, rm, mv, npm/bun/cargo, mkdir, …) stays an
// individual row so state-changing commands are never hidden inside a summary.
const READ_ONLY_COMMAND_KINDS: Record<string, GroupableKind> = {
  cat: "read",
  head: "read",
  tail: "read",
  bat: "read",
  less: "read",
  more: "read",
  ls: "list",
  find: "list",
  tree: "list",
  fd: "list",
  dir: "list",
  grep: "search",
  rg: "search",
  ag: "search",
  ack: "search",
  ripgrep: "search",
  wc: "command",
  cloc: "command",
  du: "command",
  stat: "command",
  file: "command",
  which: "command",
  pwd: "command",
  echo: "command",
  env: "command",
  printenv: "command",
  date: "command",
  whoami: "command",
  uname: "command",
  hostname: "command",
};

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "log",
  "status",
  "diff",
  "show",
  "branch",
  "blame",
  "remote",
  "config",
]);

/** Classify a shell command string (verb-first) as a read-only exploring kind. */
function classifyShellCommand(command: string): GroupableKind | null {
  // Strip leading env assignments (FOO=bar) and sudo; take the first real verb.
  const tokens = command.trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  if (tokens[index] === "sudo") index += 1;
  const rawVerb = tokens[index] || "";
  // Drop any path prefix (e.g. /usr/bin/grep -> grep).
  const verb = rawVerb.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!verb) return null;
  // A command with a pipe/redirect/&& is a compound; only classify when every
  // stage is itself read-only would be ideal, but that's over-engineering —
  // treat the leading verb as the signal and keep it conservative.
  if (verb === "git") {
    const sub = (tokens[index + 1] || "").toLowerCase();
    return READ_ONLY_GIT_SUBCOMMANDS.has(sub) ? "command" : null;
  }
  return READ_ONLY_COMMAND_KINDS[verb] ?? null;
}

function groupKindForActivity(activity: LiveActivityItem): GroupableKind | null {
  if (activity.phase !== "result") return null;
  const toolName = activity.toolName?.toLowerCase() || "";
  if (toolName in GROUPABLE_TOOL_KINDS) return GROUPABLE_TOOL_KINDS[toolName];

  // exec/process/git tools carry a "Ran <command>" summary; classify by the
  // shell verb so read-only shell exploration folds into the group too.
  if (toolName === "exec" || toolName === "process" || toolName === "git" || !toolName) {
    const ranMatch = activity.text.match(/^Ran\s+(.+)$/s);
    if (ranMatch) return classifyShellCommand(ranMatch[1]);
    // Persisted activities sometimes lack toolName; classify by canonical verb.
    if (!toolName) {
      if (/^Explored /.test(activity.text)) return "read";
      if (/^Searched /.test(activity.text)) return "search";
    }
  }
  return null;
}

function groupLabel(kinds: GroupableKind[], count: number): string {
  const unique = new Set(kinds);
  if (unique.size === 1) {
    const [only] = unique;
    if (only === "read") return `Read ${count} files`;
    if (only === "search") return `Ran ${count} searches`;
    if (only === "list") return `Listed ${count} locations`;
  }
  // Mixed exploration, or generic read-only commands.
  return `Ran ${count} commands`;
}

/**
 * Collapse consecutive completed exploring activities (reads / lists /
 * searches / read-only shell commands) into one summary group, matching the
 * Codex TUI's exploring cell. Different exploring kinds fold into the same run
 * (a group of ls + find + grep becomes "Ran 3 commands"); a group forms only
 * from 2+ consecutive entries. State-changing/unknown commands, failures, and
 * in-flight steps are never grouped, so nothing actionable is hidden.
 */
export function groupActivitiesForDisplay(activities: LiveActivityItem[]): ActivityDisplayEntry[] {
  const entries: ActivityDisplayEntry[] = [];
  let run: { kinds: GroupableKind[]; items: LiveActivityItem[] } | null = null;

  const flushRun = () => {
    if (!run) return;
    if (run.items.length >= 2) {
      const uniqueKinds = new Set(run.kinds);
      const specific = uniqueKinds.size === 1 ? [...uniqueKinds][0] : "command";
      entries.push({
        type: "group",
        id: `group-${run.items[0].id}-${run.items.length}`,
        kind: specific === "command" ? "list" : specific,
        label: groupLabel(run.kinds, run.items.length),
        items: run.items,
      });
    } else {
      for (const activity of run.items) {
        entries.push({ type: "single", activity });
      }
    }
    run = null;
  };

  for (const activity of activities) {
    const kind = groupKindForActivity(activity);
    if (kind === null) {
      flushRun();
      entries.push({ type: "single", activity });
      continue;
    }
    if (run) {
      run.kinds.push(kind);
      run.items.push(activity);
    } else {
      run = { kinds: [kind], items: [activity] };
    }
  }
  flushRun();
  return entries;
}
