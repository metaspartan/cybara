import { benchmarksApi, type IntelligenceBenchmarkRun } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Crown, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useMemo } from "react";
import { computeRatingFromResults, formatRating, ratingPercent, tierFor } from "./rating";

const matrixCategories = [
  { key: "instruction", label: "Instruction" },
  { key: "reasoning", label: "Reasoning" },
  { key: "coding", label: "Coding" },
  { key: "transformation", label: "Transform" },
  { key: "tool_use", label: "Tool use" },
] as const;

interface LeaderboardEntry {
  key: string;
  model: string;
  provider: string | null;
  bestRating: number;
  bestRun: IntelligenceBenchmarkRun;
  runCount: number;
  latestRating: number;
  trend: number;
  lastRunAt: string;
}

function buildLeaderboard(
  runs: IntelligenceBenchmarkRun[],
  suiteId: string | undefined
): LeaderboardEntry[] {
  const groups = new Map<string, IntelligenceBenchmarkRun[]>();
  for (const run of runs) {
    if (run.status !== "completed" || run.suiteId !== suiteId) continue;
    const key = run.model || run.agentId;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  const entries: LeaderboardEntry[] = [];
  for (const [key, group] of groups) {
    const chronological = [...group].sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
    const best = [...group].sort((left, right) => right.score - left.score)[0];
    const latest = chronological[chronological.length - 1];
    const previous = chronological.length > 1 ? chronological[chronological.length - 2] : null;
    entries.push({
      key,
      model: key,
      provider: best.provider,
      bestRating: best.score,
      bestRun: best,
      runCount: group.length,
      latestRating: latest.score,
      trend: previous ? latest.score - previous.score : 0,
      lastRunAt: latest.createdAt,
    });
  }
  return entries.sort((left, right) => right.bestRating - left.bestRating);
}

const rankTone = [
  "border-amber-300/40 bg-amber-300/10 text-amber-200",
  "border-gray-300/30 bg-gray-300/10 text-gray-200",
  "border-orange-400/30 bg-orange-400/10 text-orange-200",
];

export function LeaderboardPanel() {
  const query = useQuery({
    queryKey: ["lab-benchmarks"],
    queryFn: async () => {
      const response = await benchmarksApi.list();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load benchmarks");
      return response.data;
    },
  });
  const entries = useMemo(
    () => buildLeaderboard(query.data?.runs ?? [], query.data?.suite.id),
    [query.data]
  );
  const leader = entries[0];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-300" />
          <h2 className="text-sm font-semibold text-white">Model leaderboard</h2>
        </div>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-gray-400">
          Best Cybara Intelligence Rating per model across saved runs. The suite is deterministic
          and open, so ratings are directly comparable across models, providers, and time — rerun it
          after upgrades to see whether a model actually got smarter.
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-16 animate-pulse rounded-lg border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.025] text-center">
          <div className="max-w-sm p-6">
            <Trophy className="mx-auto h-8 w-8 text-gray-600" />
            <p className="mt-3 text-sm font-medium text-white">No rated runs yet</p>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">
              Complete a benchmark run in the Benchmark tab. Each model's best rating appears here
              for side-by-side comparison.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
          {entries.map((entry, index) => {
            const tier = tierFor(entry.bestRating);
            return (
              <div
                key={entry.key}
                className={cn(
                  "grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-3 last:border-b-0",
                  index === 0 && "bg-amber-300/[0.04]"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums",
                    rankTone[index] ?? "border-white/10 bg-white/[0.03] text-gray-400"
                  )}
                >
                  {index === 0 ? <Crown className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-white">{entry.model}</p>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[9px] font-medium",
                        tier.chip
                      )}
                    >
                      {tier.label}
                    </span>
                    {entry.trend !== 0 && entry.runCount > 1 && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[10px] tabular-nums",
                          entry.trend > 0 ? "text-emerald-300" : "text-red-300"
                        )}
                        title="Rating change between the two most recent runs"
                      >
                        {entry.trend > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {entry.trend > 0 ? "+" : ""}
                        {formatRating(entry.trend)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1 max-w-md overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400"
                      style={{ width: `${ratingPercent(entry.bestRating)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-gray-500">
                    {entry.runCount} run{entry.runCount === 1 ? "" : "s"} ·{" "}
                    {entry.bestRun.results.filter((result) => result.passed).length}/
                    {entry.bestRun.results.length} tasks on best run · last{" "}
                    {new Date(entry.lastRunAt).toLocaleDateString()}
                    {leader && entry !== leader
                      ? ` · ${formatRating(leader.bestRating - entry.bestRating)} behind #1`
                      : ""}
                  </p>
                </div>
                <span className={cn("text-xl font-semibold tabular-nums", tier.tone)}>
                  {formatRating(entry.bestRating)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.025]">
          <div className="border-b border-white/10 px-3 py-2.5">
            <h3 className="text-[12px] font-medium text-gray-200">Capability matrix</h3>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Per-category rating from each model's best run — shows where models differ, not just
              how much.
            </p>
          </div>
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-medium">Model</th>
                {matrixCategories.map((category) => (
                  <th key={category.key} className="px-3 py-2 text-right font-medium">
                    {category.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.key} className="border-b border-white/5 last:border-b-0">
                  <td className="max-w-[200px] truncate px-3 py-2 text-[12px] text-white">
                    {entry.model}
                  </td>
                  {matrixCategories.map((category) => {
                    const rating = computeRatingFromResults(
                      entry.bestRun.results.filter((result) => result.category === category.key)
                    );
                    return (
                      <td
                        key={category.key}
                        className={cn(
                          "px-3 py-2 text-right text-[12px] font-medium tabular-nums",
                          rating === null ? "text-gray-600" : tierFor(rating).tone
                        )}
                      >
                        {rating === null ? "—" : formatRating(rating)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
