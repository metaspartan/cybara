export interface TuiContextUsage {
  tokensUsed: number;
  contextWindow: number;
  percentage: number;
  compacted: boolean;
  compactionCount: number;
  compactedTokens: number;
}

export interface TuiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokensPerSecond: number | null;
  callCount: number;
}

export interface TuiPlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface TuiPlanSummary {
  completed: number;
  total: number;
}

export interface TuiPlan {
  items: TuiPlanItem[];
  summary: TuiPlanSummary;
}

export interface TuiFileChange {
  path: string;
  added: number;
  removed: number;
  type: "created" | "updated" | "deleted";
}

export interface TuiFileChangeSummary {
  files: TuiFileChange[];
  totalAdded: number;
  totalRemoved: number;
}

export interface TuiTaskSummary {
  id: string;
  title: string;
  status: string;
  priority?: string;
  sessionId?: string;
}

export interface TuiSubagentSummary {
  id: string;
  label: string;
  status: string;
}

export interface TuiLspSummary {
  id: string;
  name: string;
  command: string;
}

export interface TuiEnvironmentSnapshot {
  contextUsage: TuiContextUsage | null;
  tokenUsage: TuiTokenUsage | null;
  plan: TuiPlan | null;
  fileChanges: TuiFileChangeSummary | null;
  workspaceDir: string | null;
  gitBranch: string | null;
}

export function environmentSnapshotWithWorkspace(
  snapshot: TuiEnvironmentSnapshot | null,
  workspaceDir: string
): TuiEnvironmentSnapshot | null {
  if (!workspaceDir || snapshot?.workspaceDir) return snapshot;
  return {
    contextUsage: snapshot?.contextUsage || null,
    tokenUsage: snapshot?.tokenUsage || null,
    plan: snapshot?.plan || null,
    fileChanges: snapshot?.fileChanges || null,
    workspaceDir,
    gitBranch: snapshot?.gitBranch || null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value: unknown): TuiPlanItem["status"] {
  const status = asString(value).toLowerCase();
  if (status === "completed" || status === "done" || status === "complete") return "completed";
  if (status === "in_progress" || status === "running" || status === "active") return "in_progress";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (rounded >= 1_000) return `${Math.round(rounded / 1_000)}k`;
  return String(rounded);
}

export function shortPath(path: string, max = 42): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= max) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return `…${normalized.slice(-(max - 1))}`;
  const tail = parts.slice(-2).join("/");
  return tail.length <= max - 2 ? `…/${tail}` : `…${tail.slice(-(max - 1))}`;
}

export function contextUsageFromDetail(detail: unknown): TuiContextUsage | null {
  if (!isRecord(detail) || !isRecord(detail.contextUsage)) return null;
  const usage = detail.contextUsage;
  const tokensUsed =
    asNumber(usage.tokensUsed) || asNumber(usage.usedTokens) || asNumber(usage.currentTokens);
  const contextWindow =
    asNumber(usage.contextWindow) ||
    asNumber(usage.contextWindowTokens) ||
    asNumber(usage.maxTokens);
  const percentage =
    asNumber(usage.percentage) ||
    asNumber(usage.percent) ||
    (contextWindow > 0 ? Math.round((tokensUsed / contextWindow) * 100) : 0);
  return {
    tokensUsed,
    contextWindow,
    percentage: Math.max(0, Math.min(999, Math.round(percentage))),
    compacted: usage.compacted === true || asNumber(usage.compactionCount) > 0,
    compactionCount: asNumber(usage.compactionCount),
    compactedTokens: asNumber(usage.compactedTokens),
  };
}

export function tokenUsageFromDetail(detail: unknown): TuiTokenUsage | null {
  if (!isRecord(detail) || !isRecord(detail.tokenUsage)) return null;
  const usage = detail.tokenUsage;
  const inputTokens = asNumber(usage.inputTokens) || asNumber(usage.input);
  const outputTokens = asNumber(usage.outputTokens) || asNumber(usage.output);
  const totalTokens =
    asNumber(usage.totalTokens) || asNumber(usage.total) || inputTokens + outputTokens;
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return null;
  const speed = asNumber(usage.tokensPerSecond);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    tokensPerSecond: speed > 0 ? Number(speed.toFixed(2)) : null,
    callCount: asNumber(usage.callCount) || asNumber(usage.calls),
  };
}

function planItemsFrom(value: unknown): TuiPlanItem[] {
  return arrayFrom(value)
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const content = asString(item.content) || asString(item.title) || asString(item.task);
      if (!content) return [];
      return [{ content, status: normalizeStatus(item.status) }];
    })
    .slice(0, 20);
}

export function planFromDetail(detail: unknown): TuiPlan | null {
  if (!isRecord(detail) || !isRecord(detail.plan)) return null;
  const items = planItemsFrom(detail.plan.items);
  if (items.length === 0) return null;
  const summaryRecord = isRecord(detail.plan.summary) ? detail.plan.summary : {};
  const completed =
    asNumber(summaryRecord.completed) || items.filter((item) => item.status === "completed").length;
  const total =
    asNumber(summaryRecord.total) || items.filter((item) => item.status !== "cancelled").length;
  return { items, summary: { completed, total } };
}

function parseActivityChange(activity: unknown): TuiFileChange | null {
  if (!isRecord(activity)) return null;
  const text = asString(activity.text);
  const match = text.match(/^Edited\s+(.+?)\s+\+(\d+)\s+-(\d+)$/i);
  if (!match?.[1]) return null;
  const added = Number.parseInt(match[2] || "0", 10);
  const removed = Number.parseInt(match[3] || "0", 10);
  return {
    path: match[1].trim(),
    added: Number.isFinite(added) ? added : 0,
    removed: Number.isFinite(removed) ? removed : 0,
    type: removed > 0 ? "updated" : "created",
  };
}

function parseToolChange(tool: unknown): TuiFileChange[] {
  if (!isRecord(tool)) return [];
  const result = isRecord(tool.result) ? tool.result : {};
  const args = isRecord(tool.args) ? tool.args : isRecord(tool.arguments) ? tool.arguments : {};
  const changes = arrayFrom(result.changes).flatMap((change) => {
    if (!isRecord(change)) return [];
    const path = asString(change.path);
    if (!path) return [];
    const added = asNumber(change.added) || asNumber(change.addedLines) || asNumber(change.plus);
    const removed =
      asNumber(change.removed) || asNumber(change.removedLines) || asNumber(change.minus);
    const type: TuiFileChange["type"] = removed > 0 ? "updated" : "created";
    return [{ path, added, removed, type }];
  });
  if (changes.length > 0) return changes as TuiFileChange[];

  const name = asString(tool.name).toLowerCase();
  const path = asString(args.path) || asString(result.path);
  if (!path) return [];
  if (name === "write") {
    const content = asString(args.content);
    return [
      { path, added: content ? content.split(/\r?\n/).length : 0, removed: 0, type: "created" },
    ];
  }
  if (name === "edit") {
    const before = asString(args.oldText);
    const after = asString(args.newText);
    return [
      {
        path,
        added: after ? after.split(/\r?\n/).length : 0,
        removed: before ? before.split(/\r?\n/).length : 0,
        type: "updated",
      },
    ];
  }
  return [];
}

function normalizedChangePath(path: string, workspaceDir?: string | null): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "");
  const workspace = workspaceDir
    ?.replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  if (!workspace) return normalized;
  const comparablePath = normalized.toLowerCase();
  const comparableWorkspace = workspace.toLowerCase();
  if (comparablePath.startsWith(`${comparableWorkspace}/`)) {
    return normalized.slice(workspace.length + 1);
  }
  return normalized;
}

function changeBasename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) || path;
}

function mergeFileChange(byPath: Map<string, TuiFileChange>, change: TuiFileChange): void {
  const existing = byPath.get(change.path) || { ...change, added: 0, removed: 0 };
  existing.added += change.added;
  existing.removed += change.removed;
  existing.type = existing.removed > 0 ? "updated" : change.type;
  byPath.set(change.path, existing);
}

export function fileChangesFromMessages(
  messages: unknown,
  workspaceDir?: string | null
): TuiFileChangeSummary | null {
  const byPath = new Map<string, TuiFileChange>();
  const activities: TuiFileChange[] = [];
  for (const message of arrayFrom(messages)) {
    if (!isRecord(message)) continue;
    for (const activity of arrayFrom(message.process_activities)) {
      const change = parseActivityChange(activity);
      if (!change) continue;
      activities.push({ ...change, path: normalizedChangePath(change.path, workspaceDir) });
    }
    for (const change of arrayFrom(message.tool_calls).flatMap(parseToolChange)) {
      mergeFileChange(byPath, {
        ...change,
        path: normalizedChangePath(change.path, workspaceDir),
      });
    }
  }
  const structuredBasenames = new Set(Array.from(byPath.keys(), changeBasename));
  for (const activity of activities) {
    if (byPath.has(activity.path) || structuredBasenames.has(changeBasename(activity.path)))
      continue;
    mergeFileChange(byPath, activity);
  }
  const files = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return null;
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.added, 0),
    totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

export function messagesFromDetail(detail: unknown): unknown[] {
  if (!isRecord(detail)) return [];
  if (Array.isArray(detail.messagesList)) return detail.messagesList;
  if (Array.isArray(detail.messages)) return detail.messages;
  return [];
}

export function environmentSnapshotFromDetail(detail: unknown): TuiEnvironmentSnapshot {
  const messages = messagesFromDetail(detail);
  const workspaceDir = isRecord(detail)
    ? asString(detail.workspace_dir) || asString(detail.workspaceDir) || null
    : null;
  return {
    contextUsage: contextUsageFromDetail(detail),
    tokenUsage: tokenUsageFromDetail(detail),
    plan: planFromDetail(detail),
    fileChanges: fileChangesFromMessages(messages, workspaceDir),
    workspaceDir,
    gitBranch: isRecord(detail)
      ? asString(detail.gitBranch) || asString(detail.branch) || null
      : null,
  };
}

export function tasksFromResponse(value: unknown): TuiTaskSummary[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.tasks)
      ? value.tasks
      : [];
  return raw.flatMap((task) => {
    if (!isRecord(task)) return [];
    const id = asString(task.id);
    const title = asString(task.title) || asString(task.name) || asString(task.description);
    if (!id && !title) return [];
    return [
      {
        id: id || title,
        title: title || id,
        status: asString(task.status) || "unknown",
        priority: asString(task.priority) || undefined,
        sessionId: asString(task.session_id) || asString(task.sessionId) || undefined,
      },
    ];
  });
}

export function tasksForSession(value: unknown, sessionId: string): TuiTaskSummary[] {
  return tasksFromResponse(value).filter((task) => !task.sessionId || task.sessionId === sessionId);
}

export function subagentsFromResponse(value: unknown): TuiSubagentSummary[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.subagents)
      ? value.subagents
      : [];
  return raw.flatMap((subagent) => {
    if (!isRecord(subagent)) return [];
    const id = asString(subagent.id) || asString(subagent.subagentId);
    const label = asString(subagent.label) || asString(subagent.task) || asString(subagent.name);
    if (!id && !label) return [];
    return [
      { id: id || label, label: label || id, status: asString(subagent.status) || "unknown" },
    ];
  });
}

export function lspServersFromResponse(value: unknown): TuiLspSummary[] {
  if (!isRecord(value)) return [];
  return arrayFrom(value.active).flatMap((server) => {
    if (!isRecord(server) || server.initialized === false) return [];
    const id = asString(server.id);
    const name = asString(server.name) || id;
    const command = asString(server.command) || name;
    if (!id && !name) return [];
    return [{ id: id || name, name: name || id, command }];
  });
}

export function formatContextUsageLine(usage: TuiContextUsage | null): string {
  if (!usage) return "Context: no sample";
  const window = usage.contextWindow > 0 ? ` / ${formatCompactNumber(usage.contextWindow)}` : "";
  const compacted =
    usage.compacted || usage.compactionCount > 0
      ? ` · compacted ${usage.compactionCount}x${
          usage.compactedTokens > 0
            ? ` (${formatCompactNumber(usage.compactedTokens)} summarized)`
            : ""
        }`
      : "";
  return `Context: ${usage.percentage}% · ${formatCompactNumber(usage.tokensUsed)}${window} tokens${compacted}`;
}

export function formatTokenUsageLine(usage: TuiTokenUsage | null): string {
  if (!usage) return "Tokens: none recorded";
  const speed =
    usage.tokensPerSecond !== null ? ` · ${usage.tokensPerSecond} tok/s` : " · no speed sample";
  return `Tokens: ${formatCompactNumber(usage.inputTokens)} in / ${formatCompactNumber(
    usage.outputTokens
  )} out · ${formatCompactNumber(usage.totalTokens)} total${speed}`;
}

export function formatPlanLine(plan: TuiPlan | null): string {
  if (!plan) return "Plan: none";
  const activeItems = plan.items.filter((item) => item.status !== "cancelled");
  const active =
    activeItems.find((item) => item.status === "in_progress") ||
    activeItems.find((item) => item.status === "pending") ||
    activeItems[activeItems.length - 1];
  return `Plan: ${plan.summary.completed}/${plan.summary.total} complete${
    active ? ` · ${active.content}` : ""
  }`;
}

export function formatFileChangeLine(changes: TuiFileChangeSummary | null): string {
  if (!changes) return "Diffs: none";
  return `Diffs: ${changes.files.length} files · +${changes.totalAdded} -${changes.totalRemoved}`;
}

export function formatTaskLine(task: TuiTaskSummary): string {
  return `${task.status.padEnd(10)} ${task.priority ? `[${task.priority}] ` : ""}${task.title}`;
}

export function formatSubagentLine(subagent: TuiSubagentSummary): string {
  return `${subagent.status.padEnd(10)} ${subagent.label}`;
}
