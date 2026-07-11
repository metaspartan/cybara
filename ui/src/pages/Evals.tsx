import { PageLayout } from "@/components/layout/PageLayout";
import { type AgentEvalRun, type AgentGolden, evalsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  GitFork,
  Loader2,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function statusIcon(status: AgentEvalRun["status"]) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-amber-400" />;
  return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
}

function runTone(status: AgentEvalRun["status"]): string {
  if (status === "passed") return "border-emerald-400/20 bg-emerald-400/[0.06]";
  if (status === "failed") return "border-red-400/20 bg-red-400/[0.06]";
  if (status === "error") return "border-amber-400/20 bg-amber-400/[0.06]";
  return "border-blue-400/20 bg-blue-400/[0.06]";
}

function GoldenRow({
  golden,
  latestRun,
  busy,
  onReplay,
  onDelete,
}: {
  golden: AgentGolden;
  latestRun?: AgentEvalRun;
  busy: boolean;
  onReplay: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 shrink-0 text-indigo-300" />
            <h2 className="truncate text-sm font-semibold text-white">{golden.name}</h2>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-gray-400">
            {golden.description || golden.baseline.request.userMessage.content}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReplay}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-gray-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Replay
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
            title="Delete golden"
            aria-label="Delete golden"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>{golden.baseline.model || "Current model"}</span>
        <span>·</span>
        <span>{golden.baseline.structure.tools.length} expected tools</span>
        {golden.tags.map((tag) => (
          <span key={tag} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-gray-400">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {golden.baseline.structure.tools.map((tool, index) => (
          <span
            key={`${tool.name}-${index}`}
            className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px] text-gray-400"
          >
            {index + 1}. {tool.name}
          </span>
        ))}
        {golden.baseline.structure.tools.length === 0 && (
          <span className="text-[11px] text-gray-600">Response-only baseline</span>
        )}
      </div>

      {latestRun && (
        <div className={cn("mt-3 rounded-md border px-3 py-2", runTone(latestRun.status))}>
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 font-medium text-gray-200">
              {statusIcon(latestRun.status)}
              {latestRun.status === "passed"
                ? "Structurally equivalent"
                : latestRun.status === "failed"
                  ? "Behavior diverged"
                  : latestRun.status === "error"
                    ? "Replay error"
                    : "Running"}
            </span>
            {latestRun.score !== null && <span className="text-gray-400">{latestRun.score}%</span>}
          </div>
          {latestRun.error && (
            <p className="mt-1 text-[11px] text-amber-200/80">{latestRun.error}</p>
          )}
          {latestRun.comparison && latestRun.comparison.differences.length > 0 && (
            <div className="mt-2 space-y-1 text-[11px] text-gray-400">
              {latestRun.comparison.differences.slice(0, 4).map((difference) => (
                <div key={difference.path} className="font-mono">
                  {difference.path}
                </div>
              ))}
            </div>
          )}
          {latestRun.replaySessionId && (
            <Link
              to={`/chat?session=${encodeURIComponent(latestRun.replaySessionId)}`}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200"
            >
              <GitFork className="h-3 w-3" />
              Open replay chat
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function Evals() {
  const queryClient = useQueryClient();
  const [busyGoldenId, setBusyGoldenId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["agent-evals"],
    queryFn: async () => {
      const response = await evalsApi.list();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load evals");
      return response.data;
    },
  });
  const latestRuns = useMemo(() => {
    const map = new Map<string, AgentEvalRun>();
    for (const run of query.data?.runs ?? []) {
      if (!map.has(run.goldenId)) map.set(run.goldenId, run);
    }
    return map;
  }, [query.data?.runs]);
  const replay = useMutation({
    mutationFn: async (goldenId: string) => {
      setBusyGoldenId(goldenId);
      const response = await evalsApi.replay(goldenId);
      if (!response.success || !response.data?.run)
        throw new Error(response.error || "Replay failed");
      return response.data.run;
    },
    onSettled: () => {
      setBusyGoldenId(null);
      void queryClient.invalidateQueries({ queryKey: ["agent-evals"] });
    },
  });
  const runSuite = useMutation({
    mutationFn: async () => {
      const response = await evalsApi.runSuite();
      if (!response.success) throw new Error(response.error || "Suite failed");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["agent-evals"] }),
  });
  const remove = useMutation({
    mutationFn: async (goldenId: string) => {
      const response = await evalsApi.deleteGolden(goldenId);
      if (!response.success || response.data?.success === false) throw new Error("Delete failed");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["agent-evals"] }),
  });
  const goldens = query.data?.goldens ?? [];

  return (
    <PageLayout
      title="Evals"
      subtitle="Replayable agent trajectories and structural regression tests"
      actions={
        <button
          type="button"
          onClick={() => runSuite.mutate()}
          disabled={goldens.length === 0 || runSuite.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-indigo-400/25 bg-indigo-400/10 px-3 text-[12px] font-medium text-indigo-100 hover:bg-indigo-400/15 disabled:opacity-50"
        >
          {runSuite.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run suite
        </button>
      }
    >
      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-40 animate-pulse rounded-lg border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : query.isError ? (
        <div className="rounded-lg border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">
          {query.error instanceof Error ? query.error.message : "Failed to load evals"}
        </div>
      ) : goldens.length === 0 ? (
        <div className="flex min-h-[360px] items-center justify-center text-center">
          <div className="max-w-sm">
            <FlaskConical className="mx-auto h-9 w-9 text-gray-600" />
            <h2 className="mt-4 text-base font-semibold text-white">No golden tests yet</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Open a completed chat and save a turn as a golden test from its message actions.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {goldens.map((golden) => (
            <GoldenRow
              key={golden.id}
              golden={golden}
              latestRun={latestRuns.get(golden.id)}
              busy={busyGoldenId === golden.id}
              onReplay={() => replay.mutate(golden.id)}
              onDelete={() => remove.mutate(golden.id)}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
