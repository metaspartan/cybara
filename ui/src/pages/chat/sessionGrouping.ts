import { sessionDisplayTitle, sessionPreviewText, sessionRouteLabel } from "./chatModel";

export interface ChatSidebarSession {
  id: string;
  title?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  provider?: string | null;
  provider_name?: string | null;
  model?: string | null;
  created_at?: string;
  updated_at?: string;
  workspace_dir?: string | null;
  pinned?: boolean;
  message_count?: number;
  last_message?: { role: string; content: string } | null;
}

export interface ChatSidebarSessionGroup {
  id: string;
  label: string;
  kind: "pinned" | "workspace" | "unassigned";
  sessions: ChatSidebarSession[];
  latestTime: number;
}

function sessionTime(session: ChatSidebarSession): number {
  return new Date(session.updated_at || session.created_at || 0).getTime();
}

function sortSessionsByRecent(sessions: ChatSidebarSession[]): ChatSidebarSession[] {
  return [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a));
}

export function workspaceSidebarLabel(path?: string | null): string {
  if (typeof path !== "string" || !path.trim()) return "No Workspace";
  const normalized = path.trim().replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function sessionMatchesQuery(session: ChatSidebarSession, query: string): boolean {
  if (!query) return true;
  const record = session as unknown as Record<string, unknown>;
  const searchable = [
    sessionDisplayTitle(record),
    sessionPreviewText(session.last_message?.content),
    sessionRouteLabel(record),
    workspaceSidebarLabel(session.workspace_dir),
    session.workspace_dir,
    session.id,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

export function groupSessionsForSidebar(
  sessions: ChatSidebarSession[] | undefined,
  searchQuery: string
): ChatSidebarSessionGroup[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = (sessions || []).filter((session) => sessionMatchesQuery(session, query));
  const pinned = sortSessionsByRecent(filtered.filter((session) => session.pinned === true));
  const unpinned = filtered.filter((session) => session.pinned !== true);
  const groups: ChatSidebarSessionGroup[] = [];

  if (pinned.length > 0) {
    groups.push({
      id: "pinned",
      label: "Pinned",
      kind: "pinned",
      sessions: pinned,
      latestTime: sessionTime(pinned[0]),
    });
  }

  const workspaceGroups = new Map<string, ChatSidebarSession[]>();
  for (const session of unpinned) {
    const workspacePath =
      typeof session.workspace_dir === "string" ? session.workspace_dir.trim() : "";
    const key = workspacePath ? `workspace:${workspacePath}` : "__unassigned";
    workspaceGroups.set(key, [...(workspaceGroups.get(key) || []), session]);
  }

  for (const [key, groupSessions] of workspaceGroups) {
    const sorted = sortSessionsByRecent(groupSessions);
    groups.push({
      id: key,
      label:
        key === "__unassigned" ? "No Workspace" : workspaceSidebarLabel(sorted[0]?.workspace_dir),
      kind: key === "__unassigned" ? "unassigned" : "workspace",
      sessions: sorted,
      latestTime: sessionTime(sorted[0]),
    });
  }

  return groups.sort((a, b) => {
    if (a.kind === "pinned") return -1;
    if (b.kind === "pinned") return 1;
    if (a.kind === "workspace" && b.kind === "unassigned") return -1;
    if (a.kind === "unassigned" && b.kind === "workspace") return 1;
    return b.latestTime - a.latestTime || a.label.localeCompare(b.label);
  });
}
