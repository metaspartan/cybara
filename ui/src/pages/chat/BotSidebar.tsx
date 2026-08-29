import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Input, Modal, Textarea } from "@/components/ui";
import { botsApi, extractApiError } from "@/lib/api";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { BotRosterItem } from "@/types";
import { buildSessionChatPath } from "./chatRoute";

interface BotSidebarProps {
  activeSessionIds: string[];
  currentSessionId: string | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

const BOT_COLORS = [
  ["#a855f7", "#6d28d9"],
  ["#06b6d4", "#0e7490"],
  ["#f43f5e", "#be123c"],
  ["#22c55e", "#15803d"],
  ["#f59e0b", "#b45309"],
  ["#3b82f6", "#1d4ed8"],
] as const;

function botColorIndex(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % BOT_COLORS.length;
}

function BotAvatar({ bot, active }: { bot: BotRosterItem; active: boolean }) {
  const colors = BOT_COLORS[botColorIndex(bot.id)];
  return (
    <span
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/15 text-sm font-semibold text-white shadow-lg"
      style={{ background: `linear-gradient(145deg, ${colors[0]}, ${colors[1]})` }}
      aria-hidden="true"
    >
      {bot.name.trim().slice(0, 2).toUpperCase() || <Bot className="h-4 w-4" />}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface-primary)]",
          active ? "bg-emerald-400" : "bg-gray-600"
        )}
      />
    </span>
  );
}

function previewForBot(bot: BotRosterItem): string {
  const message = bot.session?.last_message?.content?.trim();
  return message || bot.description || bot.title;
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
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [baseAgentId, setBaseAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const bots = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) return botsQuery.data ?? [];
    return (botsQuery.data ?? []).filter((bot) =>
      [bot.name, bot.title, bot.description, previewForBot(bot), bot.model]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [botsQuery.data, deferredQuery]);
  const activeBots = useMemo(
    () => (botsQuery.data ?? []).filter((bot) => activeIds.has(bot.session_id)),
    [activeIds, botsQuery.data]
  );
  const openBot = useMutation({
    mutationFn: async (id: string) => {
      const response = await botsApi.ensureSession(id);
      if (!response.success || !response.data) {
        throw new Error(extractApiError(response, "Could not open bot"));
      }
      return response.data.session_id;
    },
    onSuccess: (sessionId) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
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
      setError(null);
      onCreateOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      navigate(buildSessionChatPath(data.session_id));
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not create bot"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 px-2 pb-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          <input
            autoFocus
            aria-label="Search bots"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bots"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-white outline-none placeholder:text-gray-600"
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
        <div className="shrink-0 border-b border-white/5 px-2 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            <Sparkles className="h-3 w-3 text-emerald-400" />
            Active now
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {activeBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => openBot.mutate(bot.id)}
                className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl p-1.5 transition-colors hover:bg-white/5"
                title={bot.name}
              >
                <BotAvatar bot={bot} active />
                <span className="w-full truncate text-[10px] text-gray-400">{bot.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
          Bots
        </div>
        {botsQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
            <Bot className="mb-3 h-8 w-8 text-gray-700" />
            <p className="text-xs font-medium text-gray-400">
              {query ? "No matching bots" : "Create a bot for a persistent agent workspace"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {bots.map((bot) => {
              const active = activeIds.has(bot.session_id);
              const selected = currentSessionId === bot.session_id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => openBot.mutate(bot.id)}
                  disabled={openBot.isPending && openBot.variables === bot.id}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-all",
                    selected
                      ? "border border-white/10 bg-white/10 shadow-sm"
                      : "border border-transparent hover:bg-white/5"
                  )}
                >
                  <BotAvatar bot={bot} active={active} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-200">
                        {bot.name}
                      </span>
                      {bot.session?.updated_at ? (
                        <span className="shrink-0 text-[10px] text-gray-600">
                          {formatRelativeTime(bot.session.updated_at).replace(" ago", "")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      {previewForBot(bot)}
                    </span>
                  </span>
                  {openBot.isPending && openBot.variables === bot.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {botsQuery.error || openBot.error ? (
          <p className="px-2 py-3 text-xs text-red-400">
            {(botsQuery.error || openBot.error)?.message}
          </p>
        ) : null}
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => onCreateOpenChange(false)}
        title="New bot"
        description="Create a persistent agent with its own conversation and memory."
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
            placeholder="Research lead"
            required
          />
          <Input
            label="Role"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Research and synthesis"
          />
          <Textarea
            label="Description"
            value={description}
            maxLength={240}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this bot owns and how it should help"
          />
          {botsQuery.data && botsQuery.data.length > 0 ? (
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              Agent configuration
              <select
                value={baseAgentId}
                onChange={(event) => setBaseAgentId(event.target.value)}
                className="themed-form-control mt-1.5 w-full rounded-xl border px-4 py-2.5"
              >
                <option value="">Use the current default</option>
                {botsQuery.data.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                    {bot.model ? ` · ${bot.model}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
    </div>
  );
}
