import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, ConfirmDialog, Input, Modal, Textarea } from "@/components/ui";
import { useProviders } from "@/hooks/useApi";
import { botsApi, extractApiError } from "@/lib/api";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { BotRosterItem } from "@/types";
import { BotAvatar } from "./BotAvatar";
import { buildFreshChatPath, buildSessionChatPath } from "./chatRoute";
import { buildMultiChatPath, MULTI_CHAT_MAX_PANES } from "./multiChatLayout";

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
  const { data: providers = [] } = useProviders();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [baseAgentId, setBaseAgentId] = useState("");
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [actionBotId, setActionBotId] = useState<string | null>(null);
  const [editingBot, setEditingBot] = useState<BotRosterItem | null>(null);
  const [editDraft, setEditDraft] = useState<BotProfileDraft | null>(null);
  const [deletingBot, setDeletingBot] = useState<BotRosterItem | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamBotIds, setTeamBotIds] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query);
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
  });
  const createBot = useMutation({
    mutationFn: async () => {
      const response = await botsApi.create({
        name,
        title,
        description,
        base_agent_id: baseAgentId || undefined,
        model: model || undefined,
        provider_id: providerId || undefined,
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
      setBaseAgentId("");
      setModel("");
      setProviderId("");
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

  const providerModels = (selectedProviderId: string): string[] =>
    providers.find((provider) => provider.id === selectedProviderId)?.models ?? [];

  const changeCreateProvider = (nextProviderId: string): void => {
    setProviderId(nextProviderId);
    setModel(providerModels(nextProviderId)[0] ?? "");
  };

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
          Team workspace
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
                    role="button"
                    tabIndex={0}
                    onClick={() => openBot.mutate(bot.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openBot.mutate(bot.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setActionBotId(actionsOpen ? null : bot.id);
                    }}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-2 py-2 text-left transition-all",
                      selected
                        ? "border-[rgba(var(--accent-primary),0.32)] bg-[rgba(var(--accent-primary),0.12)] shadow-sm"
                        : "border-transparent hover:bg-[var(--surface-hover)]"
                    )}
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
                        {bot.session?.updated_at ? (
                          <span className="shrink-0 text-[10px] text-[var(--text-subtle)]">
                            {formatRelativeTime(bot.session.updated_at).replace(" ago", "")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                        {previewForBot(bot)}
                      </span>
                    </span>
                    {openBot.isPending && openBot.variables === bot.id ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-muted)]" />
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActionBotId(actionsOpen ? null : bot.id);
                        }}
                        className={cn(
                          "theme-muted-icon-button flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
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
                        onClick={() =>
                          navigate(
                            `/tasks?new=1&agent=${encodeURIComponent(bot.id)}&session=${encodeURIComponent(bot.session_id)}`
                          )
                        }
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        Add routine
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

      <Modal
        isOpen={createOpen}
        onClose={() => onCreateOpenChange(false)}
        title="New bot"
        description="Give a durable teammate a clear job, working style, and approval boundary."
        size="sm"
      >
        <form
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
          <Input
            label="Job title"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Release coordinator"
          />
          <Textarea
            label="Standing instructions"
            value={description}
            maxLength={2000}
            rows={5}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Own release readiness, coordinate specialists, cite evidence, and never publish without approval."
            helperText="Use this for responsibilities and boundaries that should remain true."
          />
          {allBots.length > 0 ? (
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              Start from
              <select
                value={baseAgentId}
                onChange={(event) => setBaseAgentId(event.target.value)}
                className="themed-form-control mt-1.5 w-full rounded-xl border px-4 py-2.5"
              >
                <option value="">Current default configuration</option>
                {allBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                    {bot.model ? ` · ${bot.model}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <details className="group rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)]">
            <summary className="cursor-pointer list-none rounded-2xl px-3.5 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
              Model and provider
              <span className="float-right text-xs text-[var(--text-subtle)] group-open:hidden">
                Optional
              </span>
            </summary>
            <div className="space-y-3 border-t border-[var(--surface-border)] px-3.5 pb-3.5 pt-3">
              <label className="block text-sm font-medium text-[var(--text-secondary)]">
                Provider
                <select
                  value={providerId}
                  onChange={(event) => changeCreateProvider(event.target.value)}
                  className="themed-form-control mt-1.5 w-full rounded-xl border px-4 py-2.5"
                >
                  <option value="">Inherit default provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                label="Model"
                value={model}
                list="create-bot-models"
                maxLength={200}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Inherit provider default"
                helperText="Each bot can pin its own provider and model."
              />
              <datalist id="create-bot-models">
                {providerModels(providerId).map((providerModel) => (
                  <option key={providerModel} value={providerModel} />
                ))}
              </datalist>
            </div>
          </details>
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--text-muted)]">
            This bot gets one continuous conversation, persistent memory, its own model
            configuration, tools, and background work.
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onCreateOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createBot.isPending}
              disabled={!name.trim()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Create bot
            </Button>
          </div>
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
      >
        {editingBot && editDraft ? (
          <form
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
                },
              });
            }}
          >
            <div className="flex items-center gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-3">
              <BotAvatar
                bot={{ ...editingBot, name: editDraft.name || editingBot.name }}
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
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setEditingBot(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={updateBot.isPending}
                disabled={!editDraft.name.trim()}
              >
                Save profile
              </Button>
            </div>
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
