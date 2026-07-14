import { useEffect, useMemo, useState } from "react";
import { Brain, CalendarDays, LibraryBig, Search, Sparkles } from "lucide-react";
import { PageLayout } from "@/components/layout";
import { apiFetch } from "@/lib/auth";

interface JourneyEvent {
  id: string;
  kind: "skill" | "memory";
  title: string;
  detail: string;
  category: string;
  createdAt: string;
  createdAtMs: number;
  source: string;
}

interface JourneyResponse {
  events: JourneyEvent[];
  counts: { skills: number; memories: number; total: number };
  firstAt: string | null;
  lastAt: string | null;
}

type JourneyFilter = "all" | JourneyEvent["kind"];

function relativeTime(ms: number): string {
  if (!ms) return "unknown";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dayKey(ms: number): string {
  if (!ms) return "Undated";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function timeSpan(firstAt: string | null, lastAt: string | null): string {
  if (!firstAt || !lastAt) return "No history yet";
  const first = Date.parse(firstAt);
  const last = Date.parse(lastAt);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return "History available";
  const days = Math.max(1, Math.ceil((last - first) / 86_400_000));
  return days === 1 ? "1 day" : `${days} days`;
}

export function Journey() {
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<JourneyFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await apiFetch("/api/journey");
        if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
        const json = (await res.json()) as JourneyResponse;
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load journey");
        }
      }
    };
    void load();
    const interval = setInterval(load, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.events ?? []).filter((event) => {
      if (filter !== "all" && event.kind !== filter) return false;
      if (!normalizedQuery) return true;
      return `${event.title} ${event.detail} ${event.category}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [data?.events, filter, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, JourneyEvent[]>();
    for (const event of filteredEvents) {
      const key = dayKey(event.createdAtMs);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [filteredEvents]);

  const recentCount = useMemo(() => {
    const threshold = Date.now() - 7 * 86_400_000;
    return (data?.events ?? []).filter((event) => event.createdAtMs >= threshold).length;
  }, [data?.events]);

  return (
    <PageLayout title="Journey" subtitle="Skills and durable memories learned over time">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-border)] lg:grid-cols-4">
          <JourneyStat icon={LibraryBig} label="Skills" value={data?.counts.skills ?? 0} />
          <JourneyStat icon={Brain} label="Memories" value={data?.counts.memories ?? 0} />
          <JourneyStat icon={Sparkles} label="Learned this week" value={recentCount} />
          <JourneyStat
            icon={CalendarDays}
            label="Learning span"
            value={timeSpan(data?.firstAt ?? null, data?.lastAt ?? null)}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit rounded-md bg-[var(--surface-raised)] p-1">
            {(["all", "skill", "memory"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  filter === option
                    ? "bg-[rgb(var(--accent-primary))] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="flex h-9 w-full items-center gap-2 rounded-md border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 sm:max-w-xs">
            <Search className="h-4 w-4 text-[var(--icon-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search learning history"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-gray-100 outline-none placeholder:text-[var(--text-subtle)]"
            />
          </label>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {data && filteredEvents.length === 0 && !error ? (
          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-10 text-center">
            <Sparkles className="mx-auto h-5 w-5 text-[rgb(var(--accent-primary))]" />
            <p className="mt-3 text-sm font-medium text-gray-100">
              {data.events.length === 0 ? "No learning yet" : "No matching learning"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Skills and durable memories appear here as agents learn.
            </p>
          </div>
        ) : null}

        <div className="space-y-8">
          {grouped.map(([day, events]) => (
            <section key={day}>
              <div className="sticky top-0 z-10 mb-3 bg-[var(--surface-backdrop)] py-2">
                <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">
                  {day}
                </span>
              </div>
              <div className="relative ml-3 space-y-3 border-l border-[var(--surface-border)] pl-6">
                {events.map((event) => (
                  <JourneyRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}

function JourneyStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Brain;
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-[var(--surface-panel)] p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}

function JourneyRow({ event }: { event: JourneyEvent }) {
  const Icon = event.kind === "skill" ? LibraryBig : Brain;
  return (
    <article className="relative rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 transition-colors hover:bg-[var(--surface-hover)]">
      <span className="absolute -left-[31px] top-5 h-3 w-3 rounded-full border-2 border-[var(--surface-backdrop)] bg-[rgb(var(--accent-primary))]" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--accent-primary))]" />
          <span className="truncate text-sm font-medium text-gray-100">{event.title}</span>
        </div>
        <span className="shrink-0 text-xs text-[var(--text-subtle)]">
          {relativeTime(event.createdAtMs)}
        </span>
      </div>
      {event.detail && event.detail !== event.title ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">
          {event.detail}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2 text-[10px] font-medium uppercase">
        <span className="rounded bg-[rgba(var(--accent-primary),0.12)] px-1.5 py-0.5 text-[rgb(var(--accent-primary))]">
          {event.kind}
        </span>
        {event.category ? <span className="text-[var(--text-muted)]">{event.category}</span> : null}
      </div>
    </article>
  );
}
