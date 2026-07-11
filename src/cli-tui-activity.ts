export interface TUIActivityItem {
  phase?: string;
  text?: string;
  toolName?: string;
}

export interface TUIToolCallItem {
  name?: string;
  status?: string;
}

export interface TUIActivitySummary {
  icon: string;
  label: string;
  details: string[];
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
