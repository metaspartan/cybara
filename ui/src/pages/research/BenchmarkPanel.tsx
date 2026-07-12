import { agentsApi, benchmarksApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

function duration(value: number): string {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function scoreTone(value: number): string {
  if (value >= 80) return "text-emerald-300";
  if (value >= 50) return "text-amber-300";
  return "text-red-300";
}

function download(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
    onSuccess: (value) => download(value.content, value.filename, value.mimeType),
  });
  const latest = benchmarkQuery.data?.runs[0];
  const activeRun = benchmarkQuery.data?.runs.find((item) => item.status === "running");
  const averageLatency = useMemo(() => {
    if (!latest?.results.length) return 0;
    return Math.round(
      latest.results.reduce((total, result) => total + result.durationMs, 0) / latest.results.length
    );
  }, [latest]);
  const categoryScores = useMemo(() => {
    const groups = new Map<string, { weight: number; earned: number }>();
    for (const result of latest?.results ?? []) {
      const group = groups.get(result.category) ?? { weight: 0, earned: 0 };
      const weight = result.weight ?? 1;
      group.weight += weight;
      if (result.passed) group.earned += weight;
      groups.set(result.category, group);
    }
    return [...groups.entries()];
  }, [latest]);
  const difficultyScores = useMemo(() => {
    const groups = new Map<string, { total: number; passed: number }>();
    for (const result of latest?.results ?? []) {
      const difficulty = result.difficulty ?? "basic";
      const group = groups.get(difficulty) ?? { total: 0, passed: 0 };
      group.total += 1;
      if (result.passed) group.passed += 1;
      groups.set(difficulty, group);
    }
    return [...groups.entries()];
  }, [latest]);
  const taskCount = benchmarkQuery.data?.suite.taskCount ?? 10;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-indigo-300" />
              <h2 className="text-sm font-semibold text-white">Quick Intelligence</h2>
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-gray-400">
              A deterministic, weighted baseline tests instruction following, advanced reasoning,
              coding, structured output, and grounded file use. Every score has an inspectable
              reason and uses no judge model.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:min-w-[410px]">
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
          </div>
        </div>
        {run.isError && (
          <p className="mt-3 text-[11px] text-red-300">
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
              Results are saved after every task. You can leave this page while the run continues.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          {
            label: latest?.status === "running" ? "Current score" : "Latest score",
            value: latest ? `${latest.score}%` : "—",
            icon: Gauge,
          },
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
          { label: "Runs saved", value: benchmarkQuery.data?.runs.length ?? 0, icon: BrainCircuit },
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

      {categoryScores.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <span className="mr-1 text-[11px] font-medium text-gray-300">Score breakdown</span>
          {categoryScores.map(([category, score]) => (
            <span
              key={category}
              className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400"
            >
              {category.replace(/_/g, " ")} ·{" "}
              {score.weight === 0 ? 0 : Math.round((score.earned / score.weight) * 100)}%
            </span>
          ))}
          <span className="mx-1 h-5 w-px bg-white/10" />
          {difficultyScores.map(([difficulty, score]) => (
            <span
              key={difficulty}
              className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400"
            >
              {difficulty} · {score.passed}/{score.total}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-medium text-gray-200">Run history</h2>
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
              Export JSONL
            </button>
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
            Run the suite against an agent to create a comparable baseline.
          </div>
        ) : (
          benchmarkQuery.data?.runs.map((item) => (
            <div key={item.id} className="border-b border-white/10 last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedRun((current) => (current === item.id ? null : item.id))}
                className="grid w-full grid-cols-[minmax(0,1fr)_80px_90px] items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-white">
                    {item.model || item.agentId}
                  </span>
                  <span className="block text-[10px] text-gray-500">
                    {item.status === "running"
                      ? `Running task ${Math.min(item.currentTask + 1, taskCount)} of ${taskCount}`
                      : item.status === "error"
                        ? item.error || "Run interrupted"
                        : new Date(item.createdAt).toLocaleString()}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-right text-[12px] font-semibold tabular-nums",
                    scoreTone(item.score)
                  )}
                >
                  {item.status === "running"
                    ? `${item.currentTask}/${taskCount}`
                    : `${item.score}%`}
                </span>
                <span className="text-right text-[10px] text-gray-500">
                  {item.status === "running"
                    ? "in progress"
                    : `${item.results.filter((result) => result.passed).length}/${item.results.length} passed`}
                </span>
              </button>
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
                        <span>{result.difficulty ?? "basic"}</span>
                        <span>·</span>
                        <span>{result.weight ?? 1} point weight</span>
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
          ))
        )}
      </div>
    </div>
  );
}
