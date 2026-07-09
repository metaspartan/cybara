import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useDeleteSession,
  useLoadSession,
  usePinSession,
  useRenameSession,
  useSessions,
} from "@/hooks/useChat";
import { Button, Modal } from "@/components/ui";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { connectStatusStream } from "@/lib/status-stream";
import type { SessionContextUsage, SessionTokenUsage } from "@/types";
import type { ChatMessage } from "./chatModel";
import { sessionDisplayTitle, sessionPreviewText, sessionRouteLabel } from "./chatModel";
import {
  groupSessionsForSidebar,
  type ChatSidebarSession,
  type ChatSidebarSessionGroup,
} from "./sessionGrouping";

interface SessionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  activeSessionIds: string[];
  currentSessionLoading: boolean;
  onLoadSession: (
    sessionId: string,
    messages: ChatMessage[],
    workspaceDir?: string | null,
    agentId?: string | null,
    contextUsage?: SessionContextUsage | null,
    tokenUsage?: SessionTokenUsage | null
  ) => void;
  onNewSession: () => void;
}

const PINNED_WORKSPACE_GROUPS_STORAGE_KEY = "cybara.chat.pinnedWorkspaceGroupIds";
const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.chat.sidebarWidth";
const CHAT_SIDEBAR_MIN_WIDTH = 248;
const CHAT_SIDEBAR_MAX_WIDTH = 420;

interface SessionTooltipState {
  anchor: DOMRect;
  displayTitle: string;
  previewText: string | null;
  routeLabel: string | null;
  session: ChatSidebarSession;
}

function readPinnedWorkspaceGroupIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PINNED_WORKSPACE_GROUPS_STORAGE_KEY) || "[]"
    );
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function persistPinnedWorkspaceGroupIds(ids: Set<string>) {
  window.localStorage.setItem(PINNED_WORKSPACE_GROUPS_STORAGE_KEY, JSON.stringify([...ids]));
}

function clampSidebarWidth(width: number): number {
  return Math.max(CHAT_SIDEBAR_MIN_WIDTH, Math.min(CHAT_SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function readSidebarWidth(): number {
  if (typeof window === "undefined") return 288;
  const stored = Number(window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampSidebarWidth(stored) : 288;
}

function persistSidebarWidth(width: number) {
  window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
}

function compactSidebarRelativeTime(value?: string | null): string {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.max(1, Math.floor(days / 30));
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

function sessionTooltipText(
  session: ChatSidebarSession,
  displayTitle: string,
  routeLabel: string | null,
  previewText: string | null
): string {
  const details = [displayTitle];
  if (session.workspace_dir) details.push(`Workspace: ${session.workspace_dir}`);
  if (routeLabel) details.push(`Model: ${routeLabel}`);
  details.push(`${session.message_count || 0} messages`);
  if (session.updated_at || session.created_at) {
    details.push(
      `Updated: ${new Date(session.updated_at || session.created_at || "").toLocaleString()}`
    );
  }
  if (previewText) details.push(`Latest: ${previewText}`);
  return details.join("\n");
}

function SessionHoverCard({ tooltip }: { tooltip: SessionTooltipState | null }) {
  if (!tooltip) return null;
  const left = Math.min(tooltip.anchor.right + 10, window.innerWidth - 304);
  const top = Math.max(10, Math.min(tooltip.anchor.top - 8, window.innerHeight - 216));
  const updated = tooltip.session.updated_at || tooltip.session.created_at;

  return (
    <div
      className="pointer-events-none fixed z-[80] w-72 rounded-xl border border-white/12 bg-[#181820]/95 p-3 text-left shadow-2xl shadow-black/45 backdrop-blur-xl"
      style={{ left, top }}
      data-testid="chat-session-hover-card"
    >
      <div className="truncate text-[13px] font-semibold text-white">{tooltip.displayTitle}</div>
      <div className="mt-1 text-[11px] text-gray-400">{tooltip.routeLabel || "Model pending"}</div>
      {tooltip.session.workspace_dir && (
        <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.035] px-2 py-1.5 text-[11px] leading-relaxed text-gray-300">
          <div className="text-gray-500">Workspace</div>
          <div className="truncate">{tooltip.session.workspace_dir}</div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-500">
        <span>{tooltip.session.message_count || 0} messages</span>
        <span className="truncate">
          {updated ? new Date(updated).toLocaleString() : "Updated recently"}
        </span>
      </div>
      {tooltip.previewText && (
        <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-gray-300">
          {tooltip.previewText}
        </div>
      )}
    </div>
  );
}

export function SessionsPanel({
  isOpen,
  currentSessionId,
  activeSessionIds,
  currentSessionLoading,
  onLoadSession,
  onNewSession,
}: SessionsPanelProps) {
  const { data: sessions, isLoading, refetch } = useSessions();
  const deleteSession = useDeleteSession();
  const loadSession = useLoadSession();
  const renameSession = useRenameSession();
  const pinSession = usePinSession();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [hoveredSessionTooltip, setHoveredSessionTooltip] = useState<SessionTooltipState | null>(
    null
  );
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [pinnedWorkspaceGroupIds, setPinnedWorkspaceGroupIds] = useState<Set<string>>(
    readPinnedWorkspaceGroupIds
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const sessionsRefreshTimerRef = useRef<number | null>(null);
  const sessionGroups = useMemo(() => {
    const groups = groupSessionsForSidebar(sessions, deferredSearchQuery);
    return [...groups].sort((a, b) => {
      if (a.kind === "pinned") return -1;
      if (b.kind === "pinned") return 1;
      const aPinned = a.kind === "workspace" && pinnedWorkspaceGroupIds.has(a.id);
      const bPinned = b.kind === "workspace" && pinnedWorkspaceGroupIds.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return 0;
    });
  }, [sessions, deferredSearchQuery, pinnedWorkspaceGroupIds]);

  const handleTogglePin = useCallback(
    (event: MouseEvent, sessionId: string, pinned: boolean) => {
      event.stopPropagation();
      void pinSession.mutateAsync({ sessionId, pinned: !pinned }).catch((error) => {
        console.error("Failed to toggle pin:", error);
      });
    },
    [pinSession]
  );

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (!event || typeof event !== "object") return;
        if (
          event.type !== "status" &&
          event.type !== "snapshot" &&
          event.type !== "task_completed"
        ) {
          return;
        }
        if (sessionsRefreshTimerRef.current !== null) {
          window.clearTimeout(sessionsRefreshTimerRef.current);
        }
        sessionsRefreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          sessionsRefreshTimerRef.current = null;
        }, 600);
      },
    });

    return () => {
      disconnect();
      if (sessionsRefreshTimerRef.current !== null) {
        window.clearTimeout(sessionsRefreshTimerRef.current);
        sessionsRefreshTimerRef.current = null;
      }
    };
  }, [refetch]);

  const beginResizeSidebar = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX);
      setSidebarWidth(nextWidth);
      persistSidebarWidth(nextWidth);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleLoadSession = async (sessionId: string) => {
    try {
      const result = await loadSession.mutateAsync(sessionId);
      if (result?.messagesList) {
        onLoadSession(
          sessionId,
          result.messagesList as ChatMessage[],
          (result as { workspace_dir?: string | null }).workspace_dir || null,
          (result as { agent_id?: string | null }).agent_id || null,
          (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null,
          (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
        );
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    }
  };

  const beginRenameSession = (
    event: MouseEvent,
    session: { id: string; title?: string | null }
  ) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(
      typeof session.title === "string" && session.title.trim()
        ? session.title.trim()
        : `Session ${session.id.slice(0, 8)}`
    );
  };

  const cancelRenameSession = () => {
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const submitRenameSession = async (sessionId: string) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;
    try {
      await renameSession.mutateAsync({ sessionId, title: nextTitle });
      setEditingSessionId(null);
      setEditingTitle("");
      await refetch();
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleWorkspaceGroupPin = (groupId: string) => {
    setPinnedWorkspaceGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      persistPinnedWorkspaceGroupIds(next);
      return next;
    });
    setOpenGroupMenuId(null);
  };

  const revealWorkspaceGroup = async (group: ChatSidebarSessionGroup) => {
    if (!group.workspaceDir) return;
    setOpenGroupMenuId(null);
    try {
      const response = await apiFetch("/api/ide/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: group.workspaceDir }),
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `Reveal failed with HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to reveal workspace:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="relative glass-strong border-r border-white/5 flex shrink-0 flex-col"
        style={{ width: sidebarWidth }}
        data-testid="chat-session-sidebar"
      >
        <div className="px-3 pt-3 pb-2 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="search"
              aria-label="Search sessions"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && searchQuery) {
                  event.preventDefault();
                  setSearchQuery("");
                }
              }}
              placeholder="Search chats..."
              className="w-full rounded-lg border border-white/10 bg-black/30 pl-8 pr-7 py-1.5 text-[12px] text-white placeholder:text-gray-600 !outline-none focus:border-indigo-400/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white cursor-pointer"
                title="Clear search"
                aria-label="Clear session search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <button
            onClick={onNewSession}
            className="w-full p-2.5 rounded-lg bg-[rgba(var(--accent-primary),0.1)] border border-[rgba(var(--accent-primary),0.2)] hover:bg-[rgba(var(--accent-primary),0.15)] text-white text-[12px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : sessions?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No chats yet</p>
              <p className="text-[10px] mt-1 text-gray-600">Start chatting to create one</p>
            </div>
          ) : sessionGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No matching chats</p>
              <p className="text-[10px] mt-1 text-gray-600">Try a different search</p>
            </div>
          ) : (
            sessionGroups.map((group) => (
              <section key={group.id} className="space-y-1.5">
                <div
                  className={cn(
                    "group/session-folder relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gray-500 transition-colors",
                    group.kind !== "pinned" && "hover:bg-white/[0.04] hover:text-gray-300"
                  )}
                  data-testid="chat-session-group-header"
                  data-group-kind={group.kind}
                  data-group-id={group.id}
                  aria-expanded={group.kind === "pinned" || !collapsedGroupIds.has(group.id)}
                >
                  <button
                    type="button"
                    onClick={() => group.kind !== "pinned" && toggleGroupCollapsed(group.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 text-left",
                      group.kind !== "pinned" ? "cursor-pointer" : "cursor-default"
                    )}
                    aria-label={
                      group.kind === "pinned" ? "Pinned chats" : `${group.label} workspace`
                    }
                  >
                    {group.kind === "pinned" ? null : collapsedGroupIds.has(group.id) ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    {group.kind === "workspace" && <Folder className="h-3 w-3 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  </button>
                  {group.kind === "workspace" ? (
                    <div className="relative flex h-5 w-8 shrink-0 items-center justify-end">
                      <span className="text-[10px] text-gray-600 transition-opacity group-hover/session-folder:opacity-0">
                        {group.sessions.length}
                      </span>
                      <button
                        type="button"
                        className="absolute right-0 rounded-md p-1 text-gray-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover/session-folder:opacity-100"
                        aria-label={`${group.label} project actions`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenGroupMenuId((current) => (current === group.id ? null : group.id));
                        }}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                      {openGroupMenuId === group.id && (
                        <div className="absolute right-0 top-6 z-50 w-48 overflow-hidden rounded-xl border border-white/12 bg-[#181820]/95 p-1.5 text-[12px] text-gray-200 shadow-2xl shadow-black/45 backdrop-blur-xl">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.08]"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleWorkspaceGroupPin(group.id);
                            }}
                          >
                            {pinnedWorkspaceGroupIds.has(group.id) ? (
                              <PinOff className="h-3.5 w-3.5 text-amber-300" />
                            ) : (
                              <Pin className="h-3.5 w-3.5 text-amber-300" />
                            )}
                            {pinnedWorkspaceGroupIds.has(group.id)
                              ? "Unpin project"
                              : "Pin project"}
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.08]"
                            onClick={(event) => {
                              event.stopPropagation();
                              void revealWorkspaceGroup(group);
                            }}
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-blue-300" />
                            Reveal in Finder/Explorer
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-600">{group.sessions.length}</span>
                  )}
                </div>
                {(group.kind === "pinned" || !collapsedGroupIds.has(group.id)) &&
                  group.sessions.map((session) => {
                    const sessionRecord = session as unknown as Record<string, unknown>;
                    const displayTitle = sessionDisplayTitle(sessionRecord);
                    const routeLabel = sessionRouteLabel(sessionRecord);
                    const previewText = sessionPreviewText(session.last_message?.content);
                    const tooltip = sessionTooltipText(
                      session,
                      displayTitle,
                      routeLabel,
                      previewText
                    );
                    const isSessionActive =
                      activeSessionIds.includes(session.id) ||
                      (currentSessionLoading && currentSessionId === session.id);
                    return (
                      <div
                        key={session.id}
                        className={`deferred-list-row relative px-2.5 py-2 rounded-lg transition-all cursor-pointer group ${
                          currentSessionId === session.id
                            ? "bg-[rgba(var(--accent-primary),0.12)] border border-[rgba(var(--accent-primary),0.3)]"
                            : "bg-white/[0.03] border border-white/5 hover:border-white/15"
                        }`}
                        aria-label={tooltip}
                        onClick={() => handleLoadSession(session.id)}
                        onMouseEnter={(event) =>
                          setHoveredSessionTooltip({
                            anchor: event.currentTarget.getBoundingClientRect(),
                            displayTitle,
                            previewText,
                            routeLabel,
                            session,
                          })
                        }
                        onMouseLeave={() => setHoveredSessionTooltip(null)}
                      >
                        <div className="min-w-0 w-full">
                          {editingSessionId === session.id ? (
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                value={editingTitle}
                                autoFocus
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void submitRenameSession(session.id);
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelRenameSession();
                                  }
                                }}
                                className="min-w-0 flex-1 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[12px] text-white !outline-none focus:border-indigo-400/50"
                              />
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void submitRenameSession(session.id);
                                }}
                                disabled={renameSession.isPending}
                                className="p-1 rounded hover:bg-emerald-500/20 text-emerald-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Save title"
                              >
                                {renameSession.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  cancelRenameSession();
                                }}
                                className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                                title="Cancel rename"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="text-[12px] text-white font-medium flex w-full min-w-0 items-center gap-1.5">
                              {session.pinned && (
                                <Pin className="w-3 h-3 text-amber-400 flex-shrink-0 fill-amber-400/30" />
                              )}
                              <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                              <span className="ml-1 flex h-4 w-8 shrink-0 items-center justify-end text-[11px] font-medium text-gray-500">
                                {isSessionActive ? (
                                  <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                                ) : (
                                  compactSidebarRelativeTime(
                                    session.updated_at || session.created_at
                                  )
                                )}
                              </span>
                            </div>
                          )}
                          {editingSessionId !== session.id && (
                            <div
                              className={cn(
                                "pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-md bg-[#11111a]/90 px-1 py-0.5 shadow-lg shadow-black/30 backdrop-blur transition-opacity",
                                "opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                              )}
                            >
                              <button
                                className={cn(
                                  "p-1 rounded cursor-pointer",
                                  session.pinned
                                    ? "text-amber-400 hover:bg-amber-500/20"
                                    : "text-gray-400 hover:bg-amber-500/20 hover:text-amber-300"
                                )}
                                onClick={(event) =>
                                  handleTogglePin(event, session.id, !!session.pinned)
                                }
                                aria-label={session.pinned ? "Unpin session" : "Pin session"}
                                title={session.pinned ? "Unpin session" : "Pin session"}
                              >
                                {session.pinned ? (
                                  <PinOff className="w-3 h-3" />
                                ) : (
                                  <Pin className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                className="p-1 rounded hover:bg-indigo-500/20 text-indigo-300 cursor-pointer"
                                onClick={(event) => beginRenameSession(event, session)}
                                aria-label="Rename session"
                                title="Rename session"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                className="p-1 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setShowDeleteModal(session.id);
                                }}
                                aria-label="Delete session"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </section>
            ))
          )}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat sidebar"
          onMouseDown={beginResizeSidebar}
          className="absolute right-[-3px] top-0 z-40 h-full w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[rgba(var(--accent-primary),0.45)]"
        />
      </div>
      <SessionHoverCard tooltip={hoveredSessionTooltip} />

      <Modal
        isOpen={!!showDeleteModal}
        onClose={() => setShowDeleteModal(null)}
        title="Delete Chat"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Are you sure you want to delete this chat? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowDeleteModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (showDeleteModal) {
                  await deleteSession.mutateAsync(showDeleteModal);
                  setShowDeleteModal(null);
                }
              }}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
