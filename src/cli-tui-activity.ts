import {
  groupSharedActivities,
  sharedActivityKind,
  type SharedActivityGroupKind,
  type SharedActivityItem,
  type SharedActivityPhase,
} from "../shared/chat-activity-groups";

export interface TUIActivityItem {
  id?: string;
  phase?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  timestamp?: number;
}

export interface TUIToolCallItem {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  status?: string;
  timeline_index?: number;
}

export interface TUIActivitySummary {
  icon: string;
  label: string;
  details: string[];
}

export interface TUIActivityRow {
  id: string;
  icon: string;
  label: string;
  details: string[];
  phase: SharedActivityPhase;
  thought: boolean;
}

export function limitTUIActivityDetails(details: string[], max: number): string[] {
  if (max <= 0) return [];
  if (details.length <= max) return details;
  const visible = Math.max(1, max - 1);
  return [...details.slice(-visible), `… ${details.length - visible} earlier tool events`];
}

type ActivityKind = "edit" | "read" | "run" | "search" | "browse" | "delegate" | "other";

const KIND_META: Record<ActivityKind, { icon: string; label: string }> = {
  edit: { icon: "✎", label: "Edited files" },
  read: { icon: "▱", label: "Read files" },
  run: { icon: "▣", label: "Ran commands" },
  search: { icon: "⌕", label: "Searched code" },
  browse: { icon: "◎", label: "Browsed the web" },
  delegate: { icon: "◇", label: "Delegated work" },
  other: { icon: "·", label: "Used tools" },
};

const KIND_ORDER: ActivityKind[] = ["edit", "read", "search", "run", "browse", "delegate", "other"];

const GROUP_ICONS: Record<SharedActivityGroupKind, string> = {
  read: "▱",
  search: "⌕",
  list: "▱",
  edit: "✎",
  fetch: "◎",
  command: "▣",
};

function classifyActivity(value: string): ActivityKind {
  const normalized = value.toLowerCase();
  if (/\b(edit\w*|writ\w*|patch\w*|replac\w*|create_file|apply_patch)\b/.test(normalized))
    return "edit";
  if (/\b(read\w*|explor\w*|list_files|view_file|open_file)\b/.test(normalized)) return "read";
  if (/\b(search\w*|grep|ripgrep|find|glob|workspace_index)\b/.test(normalized)) return "search";
  if (/\b(exec\w*|command\w*|shell|terminal|process\w*|test\w*|build\w*)\b/.test(normalized))
    return "run";
  if (/\b(browser|brows\w*|fetch\w*|http|web_search|websearch|navigat\w*)\b/.test(normalized))
    return "browse";
  if (/\b(subagent\w*|delegat\w*|spawn\w*|sessions_spawn)\b/.test(normalized)) return "delegate";
  return "other";
}

function compact(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function phaseFromStatus(status: string | undefined): SharedActivityPhase {
  const normalized = status?.toLowerCase();
  if (normalized === "pending" || normalized === "executing" || normalized === "running") {
    return "start";
  }
  if (normalized === "blocked") return "blocked";
  if (normalized === "failed" || normalized === "error") return "error";
  return "result";
}

function phaseFromActivity(phase: string | undefined): SharedActivityPhase {
  return phase === "start" || phase === "error" || phase === "blocked" ? phase : "result";
}

function fallbackToolText(tool: TUIToolCallItem): string {
  const name = (tool.name || "tool").replace(/_/g, " ");
  const phase = phaseFromStatus(tool.status);
  if (phase === "start") return `Running ${name}`;
  if (phase === "error") return `${name} failed`;
  if (phase === "blocked") return `${name} blocked`;
  return `${name} completed`;
}

function toolArgString(tool: TUIToolCallItem, key: string): string | undefined {
  const value = tool.args?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function completeActivityText(
  activity: TUIActivityItem,
  tool: TUIToolCallItem | undefined
): string {
  const text = activity.text || activity.toolName || activity.phase || "";
  if (!tool || !text.endsWith("...")) return text;
  const name = (tool.name || activity.toolName || "").toLowerCase();
  if (name !== "exec" && name !== "process" && name !== "git") return text;
  const command = toolArgString(tool, "command") || toolArgString(tool, "cmd");
  if (!command) return text;
  const normalized = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join(" ")
    .trim();
  return normalized ? `Ran ${normalized}` : text;
}

function normalizedActivities(
  activities: TUIActivityItem[],
  tools: TUIToolCallItem[]
): SharedActivityItem[] {
  const toolsById = new Map(tools.flatMap((tool) => (tool.id ? [[tool.id, tool] as const] : [])));
  const claimedTools = new Set<TUIToolCallItem>();
  const normalized = activities.flatMap((activity, index) => {
    const directTool = activity.toolCallId ? toolsById.get(activity.toolCallId) : undefined;
    const matchingTool =
      directTool ||
      tools.find(
        (tool) =>
          !claimedTools.has(tool) && tool.name?.toLowerCase() === activity.toolName?.toLowerCase()
      );
    if (matchingTool) claimedTools.add(matchingTool);
    const text = completeActivityText(activity, matchingTool);
    if (!text.trim()) return [];
    return [
      {
        id: activity.id || activity.toolCallId || `activity-${index}`,
        phase: phaseFromActivity(activity.phase),
        text: text.trim(),
        toolName: activity.toolName,
      },
    ];
  });
  if (normalized.length > 0) return normalized;
  return tools.map((tool, index) => ({
    id: tool.id || `tool-${index}`,
    phase: phaseFromStatus(tool.status),
    text: fallbackToolText(tool),
    toolName: tool.name,
  }));
}

function singleRow(activity: SharedActivityItem): TUIActivityRow {
  const thought = activity.toolName === "__thought";
  const kind = sharedActivityKind(activity) ?? "command";
  const icon = thought
    ? ""
    : activity.phase === "start"
      ? "◌"
      : activity.phase === "result"
        ? GROUP_ICONS[kind]
        : "!";
  return {
    id: activity.id,
    icon,
    label: activity.text,
    details: [],
    phase: activity.phase,
    thought,
  };
}

export function presentTUIActivities(
  activities: TUIActivityItem[],
  tools: TUIToolCallItem[]
): TUIActivityRow[] {
  return groupSharedActivities(normalizedActivities(activities, tools)).map((entry) => {
    if (entry.type === "single") return singleRow(entry.activity);
    return {
      id: entry.id,
      icon: GROUP_ICONS[entry.kind],
      label: entry.label,
      details: entry.items.map((activity) => activity.text),
      phase: "result",
      thought: false,
    };
  });
}

export function summarizeTUIActivities(
  activities: TUIActivityItem[],
  tools: TUIToolCallItem[]
): TUIActivitySummary | null {
  const raw = [
    ...activities.map((activity) => activity.text || activity.toolName || activity.phase || ""),
    ...tools.map((tool) => `${tool.name || "tool"}${tool.status ? ` ${tool.status}` : ""}`),
  ].filter(Boolean);
  if (raw.length === 0) return null;
  const kinds = new Set(raw.map(classifyActivity));
  if (kinds.size > 1) kinds.delete("other");
  const ordered = KIND_ORDER.filter((kind) => kinds.has(kind));
  const primary = ordered[0] || "other";
  return {
    icon: ordered.length === 1 ? KIND_META[primary].icon : "◇",
    label: ordered.map((kind) => KIND_META[kind].label).join(", "),
    details: Array.from(
      new Set(raw.map((value) => compact(value.replace(/\s+/g, " ").trim(), 96)))
    ).slice(-5),
  };
}
