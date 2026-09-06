import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { Button, ConfirmDialog, Input, Modal, Select, Textarea } from "@/components/ui";
import { useAgentSummaries, useDeleteSession, useProviders } from "@/hooks/useApi";
import { botsApi, chatApi, extractApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useUnreadDotColor } from "@/lib/unreadPreferences";
import { connectStatusStream } from "@/lib/status-stream";
import type { BotRosterItem } from "@/types";
import { BotAvatar } from "./BotAvatar";
import { resolveBotBaseAgentId, selectableBotBaseAgents } from "./botAgentSelection";
import { buildFreshChatPath, buildSessionChatPath } from "./chatRoute";
import { RoomCreateModal } from "./RoomCreateModal";
import { useSessions } from "@/hooks/useChat";
import { BOT_ROLE_LIST, type BotRoleId, botRolePreset } from "../../../../shared/bot-roles";
import { isRoomSessionId, ROOM_MODE_LABELS } from "../../../../shared/room-mode";
import { buildMultiChatPath, MULTI_CHAT_MAX_PANES } from "./multiChatLayout";
import {
  BOT_PROFILE_IMAGE_ACCEPT,
  BOT_PROFILE_IMAGE_MAX_BYTES,
  normalizeBotProfileImage,
} from "../../../../shared/bot-profile-image";

interface BotSidebarProps {
  activeSessionIds: string[];
  currentSessionId: string | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

interface BotProfileDraft {
  name: string;
  title: string;
  description: string;
  model: string;
  providerId: string;
  profileImage: string;
}

function previewForBot(bot: BotRosterItem): string {
  const message = bot.session?.last_message?.content?.trim();
  return message || bot.description || bot.title;
}

function profileDraft(bot: BotRosterItem): BotProfileDraft {
  return {
    name: bot.name,
    title: bot.title,
    description: bot.description,
    model: bot.model ?? "",
    providerId: bot.provider_id ?? "",
    profileImage: bot.profile_image ?? "",
  };
}

export function BotSidebar({
  activeSessionIds,
  currentSessionId,
  searchOpen,
  onSearchOpenChange,
  createOpen,
  onCreateOpenChange,
}: BotSidebarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const unreadDotColor = useUnreadDotColor();
  const { t } = useI18n();
  const { data: providers = [] } = useProviders();
  const agentsQuery = useAgentSummaries();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [baseAgentId, setBaseAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [actionBotId, setActionBotId] = useState<string | null>(null);
  const [editingBot, setEditingBot] = useState<BotRosterItem | null>(null);
  const [editDraft, setEditDraft] = useState<BotProfileDraft | null>(null);
  const [deletingBot, setDeletingBot] = useState<BotRosterItem | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const deleteRoom = useDeleteSession();
  const [role, setRole] = useState<BotRoleId | "">("");
  const [teamBotIds, setTeamBotIds] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query);
  const botsRefreshTimerRef = useRef<number | null>(null);
  const activeIds = useMemo(() => new Set(activeSessionIds), [activeSessionIds]);
  const botsQuery = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const response = await botsApi.list();
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not load bots"));
      }
      return response.data.bots;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
  const allBots = botsQuery.data ?? [];
  const refetchBots = botsQuery.refetch;
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
        if (botsRefreshTimerRef.current !== null) window.clearTimeout(botsRefreshTimerRef.current);
        botsRefreshTimerRef.current = window.setTimeout(() => {
          void refetchBots();
          botsRefreshTimerRef.current = null;
        }, 600);
      },
    });
    return () => {
      disconnect();
      if (botsRefreshTimerRef.current !== null) window.clearTimeout(botsRefreshTimerRef.current);
    };
  }, [refetchBots]);
  const { data: allSessions = [] } = useSessions();
  const roomSessionList = useMemo(
    () => allSessions.filter((session) => isRoomSessionId(session.id)),
    [allSessions]
  );
  const availableAgents = useMemo(
    () => selectableBotBaseAgents(agentsQuery.data ?? []),
    [agentsQuery.data]
  );
  const selectedBaseAgentId = resolveBotBaseAgentId(availableAgents, baseAgentId);
  const selectedBaseAgent = availableAgents.find((agent) => agent.id === selectedBaseAgentId);
  const hiddenCount = allBots.filter((bot) => bot.hidden).length;
  const visibleBots = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return allBots.filter((bot) => {
      if (bot.hidden && !showHidden) return false;
      if (!normalized) return true;
      return [bot.name, bot.title, bot.description, previewForBot(bot), bot.model]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [allBots, deferredQuery, showHidden]);
  const activeBots = useMemo(
    () => allBots.filter((bot) => !bot.hidden && activeIds.has(bot.session_id)),
    [activeIds, allBots]
  );

  const refreshBots = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["bots"] });
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  const markBotReadImmediately = (sessionId: string): void => {
    queryClient.setQueryData<BotRosterItem[]>(["bots"], (bots) =>
      bots?.map((bot) =>
        bot.session_id === sessionId && bot.session
          ? { ...bot, session: { ...bot.session, unread: false } }
          : bot
      )
    );
    void chatApi.markSessionRead(sessionId).then(refreshBots).catch(refreshBots);
  };

  const openBot = useMutation({
    mutationFn: async (id: string) => {
      const response = await botsApi.ensureSession(id);
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not open bot"));
      }
      return response.data.session_id;
    },
    onSuccess: (sessionId) => {
      refreshBots();
      navigate(buildSessionChatPath(sessionId));
    },
    onError: refreshBots,
  });
  const createBot = useMutation({
    mutationFn: async () => {
      const response = await botsApi.create({
        name,
        title,
        description,
        role: role || undefined,
        base_agent_id: selectedBaseAgentId || undefined,
      });
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not create bot"));
      }
      return response.data;
    },
    onSuccess: (data) => {
      setName("");
      setTitle("");
      setDescription("");
      setRole("");
      setBaseAgentId("");
      setError(null);
      onCreateOpenChange(false);
      refreshBots();
      navigate(buildSessionChatPath(data.session_id));
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not create bot"),
  });
  const updateBot = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Parameters<typeof botsApi.update>[1];
    }) => {
      const response = await botsApi.update(id, updates);
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not update bot"));
      }
      return response.data.bot;
    },
    onSuccess: () => {
      setEditingBot(null);
      setEditDraft(null);
      setActionBotId(null);
      refreshBots();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not update bot"),
  });
  const duplicateBot = useMutation({
    mutationFn: async (bot: BotRosterItem) => {
      const response = await botsApi.duplicate(bot.id);
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not duplicate bot"));
      }
      return response.data;
    },
    onSuccess: (data) => {
      setActionBotId(null);
      refreshBots();
      navigate(buildSessionChatPath(data.session_id));
    },
  });
  const deleteBot = useMutation({
    mutationFn: async (bot: BotRosterItem) => {
      const response = await botsApi.delete(bot.id);
      if (!response.success || !response.data?.success) {
        throw new Error(extractApiError(response, "Could not delete bot"));
      }
      return bot;
    },
    onSuccess: (bot) => {
      setDeletingBot(null);
      setActionBotId(null);
      refreshBots();
      if (currentSessionId === bot.session_id) navigate(buildFreshChatPath());
    },
  });
  const openTeam = useMutation({
    mutationFn: async () => {
      const selected = teamBotIds.slice(0, MULTI_CHAT_MAX_PANES);
      const sessions = await Promise.all(
        selected.map(async (id) => {
          const response = await botsApi.ensureSession(id);
          if (!response.success || !response.data) {
            throw new Error(extractApiError(response, "Could not prepare team workspace"));
          }
          return response.data.session_id;
        })
      );
      return sessions;
    },
    onSuccess: (sessions) => {
      setTeamOpen(false);
      refreshBots();
      navigate(buildMultiChatPath(sessions));
    },
  });
  const beginEdit = (bot: BotRosterItem): void => {
    setError(null);
    setEditingBot(bot);
    setEditDraft(profileDraft(bot));
    setActionBotId(null);
  };

  const changeProfileImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!BOT_PROFILE_IMAGE_ACCEPT.split(",").includes(file.type)) {
      setError("Profile picture must be a PNG, JPEG, or WebP image");
      input.value = "";
      return;
    }
    if (file.size > BOT_PROFILE_IMAGE_MAX_BYTES) {
      setError("Profile picture must be 2 MB or smaller");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = normalizeBotProfileImage(reader.result);
      if (image === null) {
        setError("Could not read that profile picture");
      } else {
        setEditDraft((current) => (current ? { ...current, profileImage: image } : current));
        setError(null);
      }
      input.value = "";
    };
    reader.onerror = () => {
      setError("Could not read that profile picture");
      input.value = "";
    };
    reader.readAsDataURL(file);
  };

  const providerModels = (selectedProviderId: string): string[] =>
    providers.find((provider) => provider.id === selectedProviderId)?.models ?? [];

  const changeEditProvider = (nextProviderId: string): void => {
    setEditDraft((current) =>
      current
        ? {
            ...current,
            providerId: nextProviderId,
            model: providerModels(nextProviderId)[0] ?? "",
          }
        : current
    );
  };

  const beginTeam = (): void => {
    const defaults = allBots
      .filter((bot) => !bot.hidden)
      .slice(0, Math.min(2, MULTI_CHAT_MAX_PANES))
      .map((bot) => bot.id);
    setTeamBotIds(defaults);
    setTeamOpen(true);
  };

  const toggleTeamBot = (id: string): void => {
    setTeamBotIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MULTI_CHAT_MAX_PANES) return current;
      return [...current, id];
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--text-primary)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--surface-border)] px-2 py-2">
        <button
          type="button"
          onClick={beginTeam}
          disabled={allBots.filter((bot) => !bot.hidden).length < 2}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <UsersRound className="h-3.5 w-3.5" />
          Team
        </button>
        <button
          type="button"
          onClick={() => setRoomOpen(true)}
          disabled={allBots.filter((bot) => !bot.hidden).length < 2}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          {t("chat.room.newRoom")}
        </button>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowHidden((value) => !value)}
            className={cn(
              "theme-muted-icon-button relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              showHidden && "bg-[var(--surface-hover)] text-[var(--text-primary)]"
            )}
            aria-label={showHidden ? "Hide hidden bots" : `Show ${hiddenCount} hidden bots`}
            title={showHidden ? "Hide hidden bots" : `Show ${hiddenCount} hidden bots`}
          >
            {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {!showHidden ? (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[rgb(var(--accent-primary))]" />
            ) : null}
          </button>
        ) : null}
      </div>

      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--surface-border)] px-2 pb-2 pt-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <input
            autoFocus
            aria-label="Search bots"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bots and roles"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-subtle)]"
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onSearchOpenChange(false);
            }}
            className="theme-muted-icon-button rounded p-1"
            aria-label="Close bot search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {activeBots.length > 0 ? (
        <div className="shrink-0 border-b border-[var(--surface-border)] px-2 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <Sparkles className="h-3 w-3 text-emerald-400" />
            Active now
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {activeBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => openBot.mutate(bot.id)}
                className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                title={bot.name}
              >
                <BotAvatar bot={bot} active />
                <span className="w-full truncate text-[10px] text-[var(--text-muted)]">
                  {bot.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
        <div className="flex items-center justify-between px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
          <span>{showHidden ? "Bots and hidden" : "Bots"}</span>
          <span>{visibleBots.length}</span>
        </div>
        {botsQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-[var(--text-subtle)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : visibleBots.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
            <Bot className="mb-3 h-8 w-8 text-[var(--text-subtle)]" />
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {query ? "No matching bots" : "Create a bot for a persistent agent workspace"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleBots.map((bot) => {
              const active = activeIds.has(bot.session_id);
              const selected = currentSessionId === bot.session_id;
              const actionsOpen = actionBotId === bot.id;
              return (
                <div key={bot.id} className={cn("rounded-xl", bot.hidden && "opacity-55")}>
                  <div
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setActionBotId(actionsOpen ? null : bot.id);
                    }}
                    className={cn(
                      "group flex w-full items-center rounded-xl border text-left transition-all",
                      selected
                        ? "border-[rgba(var(--accent-primary),0.32)] bg-[rgba(var(--accent-primary),0.12)] shadow-sm"
                        : "border-transparent hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        markBotReadImmediately(bot.session_id);
                        openBot.mutate(bot.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--accent-primary),0.45)]"
                    >
                      <BotAvatar bot={bot} active={active} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {bot.pinned ? (
                            <Pin className="h-3 w-3 shrink-0 text-[var(--text-subtle)]" />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
                            {bot.name}
                          </span>
                          {bot.session?.unread && !selected ? (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.12)]"
                              style={{ backgroundColor: unreadDotColor }}
                              aria-label="Unread response"
                              title="Unread response"
                            />
                          ) : null}
                          {bot.session?.updated_at ? (
                            <span className="shrink-0 text-[10px] text-[var(--text-subtle)]">
                              {formatRelativeTime(bot.session.updated_at).replace(" ago", "")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                          <span className="min-w-0 flex-1 truncate">{previewForBot(bot)}</span>
                          {(bot.routine_count ?? 0) > 0 ? (
                            <span className="shrink-0 rounded-full border border-[var(--surface-border)] px-1.5 py-0.5 text-[9px] text-[var(--text-subtle)]">
                              {bot.active_routine_count ?? 0}/{bot.routine_count}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    {openBot.isPending && openBot.variables === bot.id ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-muted)]" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActionBotId(actionsOpen ? null : bot.id)}
                        className={cn(
                          "theme-muted-icon-button mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                          actionsOpen && "bg-[var(--surface-hover)] opacity-100"
                        )}
                        aria-label={`Actions for ${bot.name}`}
                        aria-expanded={actionsOpen}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {actionsOpen ? (
                    <div className="mx-1 mb-1 mt-0.5 grid grid-cols-2 gap-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() =>
                          updateBot.mutate({ id: bot.id, updates: { pinned: !bot.pinned } })
                        }
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        {bot.pinned ? (
                          <PinOff className="h-3.5 w-3.5" />
                        ) : (
                          <Pin className="h-3.5 w-3.5" />
                        )}
                        {bot.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEdit(bot)}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit profile
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateBot.mutate(bot)}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionBotId(null);
                          navigate(
                            `/tasks?agent=${encodeURIComponent(bot.id)}&session=${encodeURIComponent(bot.session_id)}`
                          );
                        }}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        Routines
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBot.mutate({ id: bot.id, updates: { hidden: !bot.hidden } })
                        }
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        {bot.hidden ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                        {bot.hidden ? "Unhide" : "Hide"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingBot(bot)}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {botsQuery.error ||
        openBot.error ||
        updateBot.error ||
        duplicateBot.error ||
        openTeam.error ? (
          <p className="px-2 py-3 text-xs text-red-400">
            {
              (
                botsQuery.error ||
                openBot.error ||
                updateBot.error ||
                duplicateBot.error ||
                openTeam.error
              )?.message
            }
          </p>
        ) : null}
      </div>

      {roomSessionList.length > 0 ? (
        <div className="shrink-0 border-t border-[var(--surface-border)] px-2 pb-2 pt-2">
          <div className="flex items-center justify-between px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            <span>{t("chat.room.rooms")}</span>
            <span>{roomSessionList.length}</span>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {roomSessionList.map((session) => {
              const active = currentSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]",
                    active && "bg-[var(--surface-hover)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigate(buildSessionChatPath(session.id))}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {session.title || t("chat.room.untitled")}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--text-muted)]">
                        {session.room ? ROOM_MODE_LABELS[session.room.mode] : ""}
                        {session.updated_at ? ` · ${formatRelativeTime(session.updated_at)}` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingRoomId(session.id)}
                    className="theme-muted-icon-button flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    aria-label={t("chat.room.delete")}
                    title={t("chat.room.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <RoomCreateModal isOpen={roomOpen} onClose={() => setRoomOpen(false)} botsOnly />
      <ConfirmDialog
        isOpen={Boolean(deletingRoomId)}
        onClose={() => setDeletingRoomId(null)}
        onConfirm={() => {
          if (!deletingRoomId) return;
          const target = deletingRoomId;
          deleteRoom.mutate(target, {
            onSuccess: () => {
              setDeletingRoomId(null);
              if (currentSessionId === target) navigate(buildFreshChatPath());
            },
            onError: (mutationError: Error) => setError(mutationError.message),
          });
        }}
        title={t("chat.room.delete")}
        description={t("chat.room.deleteDescription")}
        confirmText={t("chat.room.delete")}
        isLoading={deleteRoom.isPending}
        variant="danger"
      />

      <Modal
        isOpen={createOpen}
        onClose={() => onCreateOpenChange(false)}
        title="New bot"
        description="Give a durable teammate a clear job, working style, and approval boundary."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onCreateOpenChange(false)}>
              Cancel
            </Button>
            <Button
              form="create-bot-form"
              type="submit"
              isLoading={createBot.isPending}
              disabled={!name.trim() || !selectedBaseAgentId || agentsQuery.isLoading}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Create bot
            </Button>
          </div>
        }
      >
        <form
          id="create-bot-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            createBot.mutate();
          }}
        >
          <Input
            data-autofocus
            label="Name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Atlas"
            required
          />
          <Select
            label={t("bots.role")}
            value={role}
            onChange={(value) => {
              const nextRole = value as BotRoleId | "";
              const preset = botRolePreset(nextRole);
              setRole(nextRole);
              if (preset && (!title.trim() || title === botRolePreset(role)?.title)) {
                setTitle(preset.title);
              }
              if (
                preset &&
                (!description.trim() || description === botRolePreset(role)?.description)
              ) {
                setDescription(preset.description);
              }
            }}
            helperText={botRolePreset(role)?.focus || t("bots.roleHelp")}
          >
            <option value="">{t("bots.roleCustom")}</option>
            {BOT_ROLE_LIST.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.title}
              </option>
            ))}
          </Select>
          <Input
            label="Job title"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Release coordinator"
          />
          <Select
            label="Agent"
            value={selectedBaseAgentId}
            onChange={setBaseAgentId}
            disabled={agentsQuery.isLoading || availableAgents.length === 0}
            helperText="The bot inherits this agent's provider, model, tools, reasoning, and capability settings."
            required
          >
            {agentsQuery.isLoading ? (
              <option value="">Loading agents...</option>
            ) : availableAgents.length === 0 ? (
              <option value="">No configured agents available</option>
            ) : (
              availableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))
            )}
          </Select>
          {selectedBaseAgent ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3.5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
                <Bot className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                  {selectedBaseAgent.name}
                </span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  {[selectedBaseAgent.type, selectedBaseAgent.model].filter(Boolean).join(" · ") ||
                    "Configured agent"}
                </span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-emerald-400" />
            </div>
          ) : null}
          {!agentsQuery.isLoading && availableAgents.length === 0 ? (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-300">
              Create an agent in Settings before adding a bot.
            </p>
          ) : null}
          <Textarea
            label="Standing instructions"
            value={description}
            maxLength={2000}
            rows={5}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Own release readiness, coordinate specialists, cite evidence, and never publish without approval."
            helperText="Use this for responsibilities and boundaries that should remain true."
          />
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-3.5">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <ShieldCheck className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
              Access and safety
            </div>
            <div className="mt-2 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-2">
              <span className="flex items-center gap-2 rounded-xl bg-[var(--surface-hover)] px-2.5 py-2">
                <Wrench className="h-3.5 w-3.5 shrink-0" />
                Inherited tools
              </span>
              <span className="flex items-center gap-2 rounded-xl bg-[var(--surface-hover)] px-2.5 py-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                Persistent memory
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
              Protected actions follow the gateway approval policy. Choose a workspace in chat when
              this bot needs project access.
            </p>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {agentsQuery.error ? (
            <p className="text-sm text-red-400">Could not load configured agents.</p>
          ) : null}
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(editingBot && editDraft)}
        onClose={() => {
          setEditingBot(null);
          setEditDraft(null);
        }}
        title="Edit bot profile"
        description="Durable role details shape how this bot works in every conversation."
        size="sm"
        footer={
          editingBot && editDraft ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditingBot(null)}>
                Cancel
              </Button>
              <Button
                form="edit-bot-form"
                type="submit"
                isLoading={updateBot.isPending}
                disabled={!editDraft.name.trim()}
              >
                Save profile
              </Button>
            </div>
          ) : null
        }
      >
        {editingBot && editDraft ? (
          <form
            id="edit-bot-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              updateBot.mutate({
                id: editingBot.id,
                updates: {
                  name: editDraft.name,
                  title: editDraft.title,
                  description: editDraft.description,
                  model: editDraft.model,
                  provider_id: editDraft.providerId,
                  profile_image: editDraft.profileImage,
                },
              });
            }}
          >
            <div className="flex items-center gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-3">
              <BotAvatar
                bot={{
                  ...editingBot,
                  name: editDraft.name || editingBot.name,
                  profile_image: editDraft.profileImage,
                }}
                showPresence={false}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {editDraft.name || "Unnamed bot"}
                </p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {editingBot.model || "Inherited model"}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                  <ImagePlus className="h-4 w-4" />
                  {editDraft.profileImage ? "Change picture" : "Add picture"}
                  <input
                    type="file"
                    accept={BOT_PROFILE_IMAGE_ACCEPT}
                    className="sr-only"
                    onChange={changeProfileImage}
                  />
                </label>
                {editDraft.profileImage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditDraft((current) =>
                        current ? { ...current, profileImage: "" } : current
                      )
                    }
                  >
                    Remove picture
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-[var(--text-subtle)]">PNG, JPEG, or WebP. Maximum 2 MB.</p>
            </div>
            <Input
              data-autofocus
              label="Name"
              value={editDraft.name}
              maxLength={80}
              onChange={(event) =>
                setEditDraft((current) =>
                  current ? { ...current, name: event.target.value } : current
                )
              }
              required
            />
            <Input
              label="Job title"
              value={editDraft.title}
              maxLength={80}
              onChange={(event) =>
                setEditDraft((current) =>
                  current ? { ...current, title: event.target.value } : current
                )
              }
            />
            <Textarea
              label="Standing instructions"
              value={editDraft.description}
              maxLength={2000}
              rows={5}
              onChange={(event) =>
                setEditDraft((current) =>
                  current ? { ...current, description: event.target.value } : current
                )
              }
              helperText="Keep durable responsibilities and approval boundaries here; use chat for the current task."
            />
            <details className="group rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)]">
              <summary className="cursor-pointer list-none rounded-2xl px-3.5 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                Model and provider
                <span className="float-right truncate pl-3 text-xs text-[var(--text-subtle)] group-open:hidden">
                  {editDraft.model || "Automatic"}
                </span>
              </summary>
              <div className="space-y-3 border-t border-[var(--surface-border)] px-3.5 pb-3.5 pt-3">
                <label className="block text-sm font-medium text-[var(--text-secondary)]">
                  Provider
                  <select
                    value={editDraft.providerId}
                    onChange={(event) => changeEditProvider(event.target.value)}
                    className="themed-form-control mt-1.5 w-full rounded-xl border px-4 py-2.5"
                  >
                    <option value="">Automatic provider</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Model"
                  value={editDraft.model}
                  list="edit-bot-models"
                  maxLength={200}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, model: event.target.value } : current
                    )
                  }
                  placeholder="Provider default"
                />
                <datalist id="edit-bot-models">
                  {providerModels(editDraft.providerId).map((providerModel) => (
                    <option key={providerModel} value={providerModel} />
                  ))}
                </datalist>
              </div>
            </details>
            <div className="grid gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--text-muted)] sm:grid-cols-3">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Gateway approvals
              </span>
              <span className="flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                {(editingBot.tool_count ?? 0) > 0
                  ? `${editingBot.tool_count} tools`
                  : "Inherited tools"}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" /> {editingBot.routine_count ?? 0} routines
              </span>
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        isOpen={teamOpen}
        onClose={() => setTeamOpen(false)}
        title="Open team workspace"
        description={`Work with up to ${MULTI_CHAT_MAX_PANES} bots side by side. Use @mentions in each chat to delegate to another specialist.`}
        size="sm"
      >
        <div className="space-y-3">
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {allBots
              .filter((bot) => !bot.hidden)
              .map((bot) => {
                const selected = teamBotIds.includes(bot.id);
                return (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => toggleTeamBot(bot.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-[rgba(var(--accent-primary),0.38)] bg-[rgba(var(--accent-primary),0.12)]"
                        : "border-[var(--surface-border)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <BotAvatar bot={bot} active={activeIds.has(bot.session_id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                        {bot.name}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-muted)]">
                        {bot.title}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        selected
                          ? "border-[rgb(var(--accent-primary))] bg-[rgb(var(--accent-primary))] text-white"
                          : "border-[var(--surface-border)] text-transparent"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {teamBotIds.length} selected · each bot keeps its own canonical history and background
            run state.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTeamOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              leftIcon={<UsersRound className="h-4 w-4" />}
              onClick={() => openTeam.mutate()}
              isLoading={openTeam.isPending}
              disabled={teamBotIds.length < 2}
            >
              Open workspace
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deletingBot)}
        onClose={() => setDeletingBot(null)}
        onConfirm={() => {
          if (deletingBot) deleteBot.mutate(deletingBot);
        }}
        title="Delete bot"
        description={`Delete ${deletingBot?.name || "this bot"}, its canonical conversation, agent configuration, and assigned routines?`}
        confirmText="Delete bot"
        isLoading={deleteBot.isPending}
        variant="danger"
      />
    </div>
  );
}
