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
  Loader2,
  MessageSquare,
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
import { GlassButton, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { connectStatusStream } from "@/lib/status-stream";
import type { SessionContextUsage } from "@/types";
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
    contextUsage?: SessionContextUsage | null
  ) => void;
  onNewSession: () => void;
}

function sessionTooltip(
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

export function SessionsPanel({
  isOpen,
  onClose,
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
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const sessionsRefreshTimerRef = useRef<number | null>(null);
  const sessionGroups = useMemo(
    () => groupSessionsForSidebar(sessions, deferredSearchQuery),
    [sessions, deferredSearchQuery]
  );

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

  const handleLoadSession = async (sessionId: string) => {
    try {
      const result = await loadSession.mutateAsync(sessionId);
      if (result?.messagesList) {
        onLoadSession(
          sessionId,
          result.messagesList as ChatMessage[],
          (result as { workspace_dir?: string | null }).workspace_dir || null,
          (result as { agent_id?: string | null }).agent_id || null,
          (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
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

  if (!isOpen) return null;

  return (
    <>
      <div className="w-72 glass-strong border-r border-white/5 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 accent-text" />
            <h3 className="text-sm font-medium text-white">Chats</h3>
            {sessions && sessions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={onNewSession}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
              aria-label="New chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
              aria-label="Close chats"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {sessions && sessions.length > 0 && (
          <div className="px-3 py-2 border-b border-white/5">
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
        )}

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
                <button
                  type="button"
                  onClick={() => group.kind !== "pinned" && toggleGroupCollapsed(group.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-gray-500 transition-colors",
                    group.kind !== "pinned"
                      ? "cursor-pointer hover:bg-white/[0.04] hover:text-gray-300"
                      : "cursor-default"
                  )}
                  data-testid="chat-session-group-header"
                  data-group-kind={group.kind}
                  data-group-id={group.id}
                  title={group.kind === "pinned" ? "Pinned chats" : `${group.label} workspace`}
                  aria-expanded={group.kind === "pinned" || !collapsedGroupIds.has(group.id)}
                >
                  {group.kind === "pinned" ? null : collapsedGroupIds.has(group.id) ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  {group.kind === "workspace" && <Folder className="h-3 w-3 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="text-[10px] text-gray-600">{group.sessions.length}</span>
                </button>
                {(group.kind === "pinned" || !collapsedGroupIds.has(group.id)) &&
                  group.sessions.map((session) => {
                    const sessionRecord = session as unknown as Record<string, unknown>;
                    const displayTitle = sessionDisplayTitle(sessionRecord);
                    const routeLabel = sessionRouteLabel(sessionRecord);
                    const previewText = sessionPreviewText(session.last_message?.content);
                    const tooltip = sessionTooltip(session, displayTitle, routeLabel, previewText);
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
                        title={tooltip}
                        aria-label={tooltip}
                        onClick={() => handleLoadSession(session.id)}
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
                              {isSessionActive ? (
                                <Loader2 className="w-3 h-3 animate-spin text-amber-400 flex-shrink-0" />
                              ) : (
                                currentSessionId === session.id && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                )
                              )}
                              {session.pinned && (
                                <Pin className="w-3 h-3 text-amber-400 flex-shrink-0 fill-amber-400/30" />
                              )}
                              <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
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
      </div>

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
            <GlassButton variant="ghost" onClick={() => setShowDeleteModal(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30"
              onClick={async () => {
                if (showDeleteModal) {
                  await deleteSession.mutateAsync(showDeleteModal);
                  setShowDeleteModal(null);
                }
              }}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </GlassButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
