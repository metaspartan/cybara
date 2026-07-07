import { useEffect, useMemo, useState } from "react";
import { Brain, LibraryBig, Sparkles } from "lucide-react";
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

function relativeTime(ms: number): string {
  if (!ms) return "unknown";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

export function Journey() {
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load journey");
      }
    };
    void load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<string, JourneyEvent[]>();
    for (const event of data?.events ?? []) {
      const key = dayKey(event.createdAtMs);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [data?.events]);

  return (
    <PageLayout title="Journey" subtitle="Everything your agent has learned — skills and memories over time">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={LibraryBig} label="Skills" value={data?.counts.skills ?? 0} tone="text-cyan-300" />
          <StatCard icon={Brain} label="Memories" value={data?.counts.memories ?? 0} tone="text-indigo-300" />
          <StatCard icon={Sparkles} label="Total learned" value={data?.counts.total ?? 0} tone="text-amber-300" />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && data.events.length === 0 && !error && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-sm font-medium text-white">No learning yet</p>
            <p className="text-xs text-gray-400 mt-1">
              As your agent saves skills and memories, they'll appear here on a timeline.
            </p>
          </div>
        )}

        <div className="space-y-8">
          {grouped.map(([day, events]) => (
            <div key={day}>
              <div className="sticky top-0 z-10 -mx-1 mb-3 bg-gradient-to-r from-white/[0.06] to-transparent px-3 py-1.5 rounded-lg">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-300">{day}</span>
              </div>
              <div className="relative ml-3 border-l border-white/10 pl-6 space-y-4">
                {events.map((event) => (
                  <JourneyRow key={event.id} event={event} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Brain;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function JourneyRow({ event }: { event: JourneyEvent }) {
  const isSkill = event.kind === "skill";
  const Icon = isSkill ? LibraryBig : Brain;
  const dot = isSkill ? "bg-cyan-400" : "bg-indigo-400";
  return (
    <div className="relative">
      <span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-black/40 ${dot}`} />
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-4 h-4 shrink-0 ${isSkill ? "text-cyan-300" : "text-indigo-300"}`} />
            <span className="text-sm font-medium text-white truncate">{event.title}</span>
          </div>
          <span className="shrink-0 text-xs text-gray-500">{relativeTime(event.createdAtMs)}</span>
        </div>
        {event.detail && event.detail !== event.title && (
          <p className="mt-1.5 text-xs text-gray-400 line-clamp-3 whitespace-pre-wrap">{event.detail}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              isSkill ? "bg-cyan-500/15 text-cyan-300" : "bg-indigo-500/15 text-indigo-300"
            }`}
          >
            {isSkill ? "skill" : "memory"}
          </span>
          {event.category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
              {event.category}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
