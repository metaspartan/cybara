import { agentsApi, benchmarksApi, type IntelligenceBenchmarkRun } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Coins,
  Download,
  FileJson,
  Loader2,
  Play,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { downloadFile, formatRating, ratingPercent, tierFor } from "./rating";

function duration(value: number): string {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function isRatedRun(run: IntelligenceBenchmarkRun, suiteId: string | undefined): boolean {
  return run.suiteId === suiteId;
}

function runScoreLabel(run: IntelligenceBenchmarkRun, suiteId: string | undefined): string {
  if (isRatedRun(run, suiteId)) return formatRating(run.score);
  return `${run.score}%`;
}

function DifficultyLadder({ run }: { run: IntelligenceBenchmarkRun }) {
  const ordered = useMemo(
    () => [...run.results].sort((left, right) => (left.rating ?? 0) - (right.rating ?? 0)),
    [run.results]
  );
  if (ordered.length === 0 || ordered.every((result) => !result.rating)) return null;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>Easiest · {formatRating(ordered[0].rating ?? 0)}</span>
        <span>Difficulty ladder</span>
        <span>Hardest · {formatRating(ordered[ordered.length - 1].rating ?? 0)}</span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {ordered.map((result) => (
          <div
            key={result.taskId}
            title={`${result.label} · ${formatRating(result.rating ?? 0)} · ${
              result.passed ? "passed" : "failed"
            }`}
            className={cn(
              "h-5 min-w-0 flex-1 rounded-sm transition-colors",
              result.passed ? "bg-emerald-400/70" : "bg-red-400/50"
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function BenchmarkPanel() {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const benchmarkQuery = useQuery({
    queryKey: ["lab-benchmarks"],
    queryFn: async () => {
      const response = await benchmarksApi.list();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load benchmarks");
      return response.data;
    },
    refetchInterval: (query) =>
      query.state.data?.runs.some((item) => item.status === "running") ? 1000 : false,
  });
  const agentsQuery = useQuery({
    queryKey: ["agent-summaries"],
    queryFn: async () => {
      const response = await agentsApi.summaries();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load agents");
      return response.data;
    },
  });
  const run = useMutation({
    mutationFn: async () => {
      const response = await benchmarksApi.run(agentId);
      if (!response.success || !response.data?.run)
        throw new Error(response.error || response.data?.error || "Benchmark failed");
      return response.data.run;
    },
    onSuccess: (value) => {
      setExpandedRun(value.id);
      void queryClient.invalidateQueries({ queryKey: ["lab-benchmarks"] });
    },
  });
  const exporter = useMutation({
    mutationFn: async () => {
      const response = await benchmarksApi.export();
      if (!response.success || !response.data)
        throw new Error(response.error || "Benchmark export failed");
      return response.data;
    },
    onSuccess: (value) => downloadFile(value.content, value.filename, value.mimeType),
  });
  const manifest = useMutation({
    mutationFn: async () => {
      const response = await benchmarksApi.manifest();
      if (!response.success || !response.data)
        throw new Error(response.error || "Manifest export failed");
      return response.data;
    },
    onSuccess: (value) => downloadFile(value.content, value.filename, value.mimeType),
  });
  const cancel = useMutation({
    mutationFn: async (runId: string) => {
      const response = await benchmarksApi.cancel(runId);
      if (!response.success || !response.data?.success)
        throw new Error(response.error || response.data?.error || "Cancel failed");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["lab-benchmarks"] }),
  });
  const remove = useMutation({
    mutationFn: async (runId: string) => {
      const response = await benchmarksApi.remove(runId);
      if (!response.success || !response.data?.success)
        throw new Error(response.error || response.data?.error || "Delete failed");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["lab-benchmarks"] }),
  });
  const suite = benchmarkQuery.data?.suite;
  const latest = benchmarkQuery.data?.runs[0];
  const activeRun = benchmarkQuery.data?.runs.find((item) => item.status === "running");
  const taskCount = suite?.taskCount ?? 0;
  const latestRated = latest && isRatedRun(latest, suite?.id);
  const latestTier = latestRated ? tierFor(latest.score) : null;
  const averageLatency = useMemo(() => {
    if (!latest?.results.length) return 0;
    return Math.round(
      latest.results.reduce((total, result) => total + result.durationMs, 0) / latest.results.length
    );
  }, [latest]);
  const categoryScores = useMemo(() => {
    const groups = new Map<string, { total: number; passed: number }>();
    for (const result of latest?.results ?? []) {
      const group = groups.get(result.category) ?? { total: 0, passed: 0 };
      group.total += 1;
      if (result.passed) group.passed += 1;
      groups.set(result.category, group);
    }
    return [...groups.entries()];
  }, [latest]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-indigo-300" />
              <h2 className="text-sm font-semibold text-white">
                {suite?.name ?? "Cybara Capability Smoke Score"}
              </h2>
              <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-gray-500">
                {suite?.id ?? "v1"}
              </span>
            </div>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-gray-400">
              {suite?.description ??
                "A reproducible, judge-free capability smoke score computed from objectively graded tasks."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
              <span className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5">
                <BadgeCheck className="h-3 w-3" /> No judge model
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5">
                <Coins className="h-3 w-3" /> ≈2k tokens per full run
              </span>
              <span className="rounded border border-white/10 px-1.5 py-0.5">
                {taskCount} tasks · {formatRating(suite?.minRating ?? 0)}–
                {formatRating(suite?.maxRating ?? 0)} internal points
              </span>
              <span className="rounded border border-white/10 px-1.5 py-0.5">
                Versioned suite score · not externally calibrated
              </span>
            </div>
            <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                aria-label="Benchmark agent"
                className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 text-[12px] text-white outline-none focus:border-indigo-400"
              >
                <option value="">Choose an agent</option>
                {(agentsQuery.data ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.model}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => run.mutate()}
                disabled={!agentId || run.isPending || !!activeRun}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-indigo-500 px-3 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                {run.isPending || activeRun ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {activeRun
                  ? `Running ${activeRun.currentTask}/${taskCount}`
                  : run.isPending
                    ? "Starting"
                    : "Run benchmark"}
              </button>
              {activeRun && (
                <button
                  type="button"
                  onClick={() => cancel.mutate(activeRun.id)}
                  disabled={cancel.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-red-400/25 bg-red-400/10 px-3 text-[12px] font-medium text-red-200 hover:bg-red-400/15 disabled:opacity-40"
                >
                  {cancel.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  Cancel
                </button>
              )}
            </div>
            {run.isError && (
              <p className="mt-2 text-[11px] text-red-300">
                {run.error instanceof Error ? run.error.message : "Benchmark failed"}
              </p>
            )}
            {activeRun && (
              <div className="mt-3" aria-label="Benchmark progress">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-[width] duration-500"
                    style={{ width: `${Math.max(2, (activeRun.currentTask / taskCount) * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-gray-500">
                  Results are saved after every task. You can leave this page while the run
                  continues.
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center justify-center gap-2 border-t border-white/10 bg-black/20 p-5 lg:border-l lg:border-t-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
              {latest?.status === "running" ? "Live suite score" : "Latest suite score"}
            </p>
            <p
              className={cn(
                "text-5xl font-semibold tabular-nums tracking-tight",
                latestTier?.tone ?? "text-white"
              )}
            >
              {latest ? (latestRated ? formatRating(latest.score) : `${latest.score}%`) : "—"}
            </p>
            {latestTier && (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                  latestTier.chip
                )}
              >
                {latestTier.label}
              </span>
            )}
            <p className="max-w-full truncate text-[11px] text-gray-500">
              {latest ? latest.model || latest.agentId : "No runs yet"}
            </p>
            {latestRated && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400"
                  style={{ width: `${ratingPercent(latest.score)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          {
            label: "Tasks passed",
            value: latest
              ? `${latest.results.filter((item) => item.passed).length}/${
                  latest.status === "running" ? taskCount : latest.results.length
                }`
              : "—",
            icon: CheckCircle2,
          },
          {
            label: "Average latency",
            value: latest ? duration(averageLatency) : "—",
            icon: Clock3,
          },
          {
            label: "Hardest solved",
            value: (() => {
              const solved = (latest?.results ?? []).filter(
                (item) => item.passed && typeof item.rating === "number"
              );
              if (solved.length === 0) return "—";
              return formatRating(Math.max(...solved.map((item) => item.rating ?? 0)));
            })(),
            icon: BrainCircuit,
          },
          { label: "Runs saved", value: benchmarkQuery.data?.runs.length ?? 0, icon: FileJson },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-semibold tabular-nums text-white">{item.value}</p>
              <item.icon className="h-4 w-4 text-gray-500" />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>

      {latest && latest.results.length > 0 && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <DifficultyLadder run={latest} />
          {categoryScores.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categoryScores.map(([category, score]) => (
                <span
                  key={category}
                  className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400"
                >
                  {category.replace(/_/g, " ")} · {score.passed}/{score.total}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[12px] font-medium text-gray-200">Run history</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => manifest.mutate()}
                disabled={manifest.isPending}
                title="Download the open suite manifest: tasks, expected answers, grading rules, rating math, and checksums for independent reproduction"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-gray-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
              >
                {manifest.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FileJson className="h-3 w-3" />
                )}
                Suite manifest
              </button>
              <button
                type="button"
                onClick={() => exporter.mutate()}
                disabled={(benchmarkQuery.data?.runs.length ?? 0) === 0 || exporter.isPending}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-gray-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
              >
                {exporter.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                Export runs JSONL
              </button>
            </div>
          </div>
        </div>
        {benchmarkQuery.isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded bg-white/[0.05]" />
            ))}
          </div>
        ) : (benchmarkQuery.data?.runs.length ?? 0) === 0 ? (
          <div className="p-10 text-center text-[12px] text-gray-500">
            Run the suite against an agent to establish a reproducible capability baseline.
          </div>
        ) : (
          benchmarkQuery.data?.runs.map((item) => {
            const rated = isRatedRun(item, suite?.id);
            const tier = rated && item.status === "completed" ? tierFor(item.score) : null;
            return (
              <div key={item.id} className="border-b border-white/10 last:border-b-0">
                <div className="flex items-center hover:bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRun((current) => (current === item.id ? null : item.id))
                    }
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_90px] items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-white">
                        {item.model || item.agentId}
                        {!rated && (
                          <span className="ml-2 rounded border border-white/10 px-1 py-px text-[9px] uppercase text-gray-500">
                            legacy suite
                          </span>
                        )}
                        {item.status === "cancelled" && (
                          <span className="ml-2 rounded border border-amber-400/30 bg-amber-400/10 px-1 py-px text-[9px] uppercase text-amber-200">
                            cancelled
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-gray-500">
                        {item.status === "running"
                          ? `Running task ${Math.min(item.currentTask + 1, taskCount)} of ${taskCount}`
                          : item.status === "error"
                            ? item.error || "Run interrupted"
                            : item.status === "cancelled"
                              ? `Cancelled after ${item.results.length} of ${taskCount} tasks`
                              : new Date(item.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <span className="flex items-center justify-end gap-2">
                      {tier && (
                        <span
                          className={cn(
                            "hidden rounded-full border px-2 py-0.5 text-[9px] font-medium sm:inline",
                            tier.chip
                          )}
                        >
                          {tier.label}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-right text-[13px] font-semibold tabular-nums",
                          tier?.tone ?? "text-gray-300"
                        )}
                      >
                        {item.status === "running"
                          ? `${item.currentTask}/${taskCount}`
                          : runScoreLabel(item, suite?.id)}
                      </span>
                    </span>
                    <span className="text-right text-[10px] text-gray-500">
                      {item.status === "running"
                        ? "in progress"
                        : `${item.results.filter((result) => result.passed).length}/${item.results.length} passed`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      item.status === "running" ? cancel.mutate(item.id) : remove.mutate(item.id)
                    }
                    disabled={remove.isPending || cancel.isPending}
                    title={item.status === "running" ? "Cancel run" : "Delete run"}
                    aria-label={item.status === "running" ? "Cancel run" : "Delete run"}
                    className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40"
                  >
                    {item.status === "running" ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {expandedRun === item.id && (
                  <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-3">
                    {item.results.map((result) => (
                      <div key={result.taskId} className="bg-[#0b0b11] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-200">
                            {result.passed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-400" />
                            )}
                            {result.label}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {duration(result.durationMs)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-[9px] uppercase text-gray-600">
                          {typeof result.rating === "number" && (
                            <>
                              <span className="text-gray-500">
                                rated {formatRating(result.rating)}
                              </span>
                              <span>·</span>
                            </>
                          )}
                          <span>{result.difficulty ?? "basic"}</span>
                          <span>·</span>
                          <span>{result.category.replace(/_/g, " ")}</span>
                        </div>
                        {result.gradingReason && (
                          <p className="mt-1.5 text-[10px] leading-4 text-gray-500">
                            {result.gradingReason}
                          </p>
                        )}
                        {!result.passed && (
                          <p className="mt-2 line-clamp-2 text-[10px] text-gray-500">
                            Expected {result.expected} · received{" "}
                            {result.error || result.response || "no response"}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
