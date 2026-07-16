import { PageLayout } from "@/components/layout/PageLayout";
import { Switch } from "@/components/ui/Switch";
import { type AgentEvalRun, type AgentGolden, evalsApi, settingsApi } from "@/lib/api";
import { readLabSettings } from "@/lib/labSettings";
import { cn } from "@/lib/utils";
import { TraceDatasetPanel } from "@/pages/research/TraceDatasetPanel";
import { BenchmarkPanel } from "@/pages/research/BenchmarkPanel";
import { LeaderboardPanel } from "@/pages/research/LeaderboardPanel";
import { ComputerUseDatasetPanel } from "@/pages/research/ComputerUseDatasetPanel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Database,
  Gauge,
  Download,
  FileJson,
  FlaskConical,
  GitFork,
  Loader2,
  MousePointer2,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

function EvalsExplainer() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("evals-explainer") === "1");
  if (dismissed) return null;
  const steps = [
    {
      icon: Bookmark,
      title: "Save a good run",
      body: "In any chat you're happy with, use the message menu to save that turn as a golden — a snapshot of what the agent did.",
    },
    {
      icon: RotateCcw,
      title: "Replay after changes",
      body: "Switched model, edited a prompt, or added a tool? Replay the golden to re-run the same request against your new setup.",
    },
    {
      icon: ShieldCheck,
      title: "Verify behavior and results",
      body: "Check tool order and data shape together with deterministic answer and tool-input assertions.",
    },
  ];
  return (
    <div className="mb-4 rounded-xl border border-indigo-400/20 bg-indigo-400/[0.06] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Reproducible agent experiments</p>
          <p className="mt-1 max-w-3xl text-[13px] leading-6 text-gray-300">
            Save representative runs, replay them under a controlled configuration, and catch
            structural or answer regressions with deterministic checks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("evals-explainer", "1");
            setDismissed(true);
          }}
          aria-label="Dismiss"
          className="rounded-md p-1 text-gray-500 hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.title} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-400/15 text-[11px] font-semibold text-indigo-200">
                {index + 1}
              </span>
              <step.icon className="h-4 w-4 text-indigo-300" />
              <span className="text-[13px] font-medium text-white">{step.title}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-gray-400">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

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
          {golden.description && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-gray-400">
              {golden.description}
            </p>
          )}
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

      <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">Saved from this request</p>
        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-300">
          {golden.baseline.request.userMessage.content || "(empty prompt)"}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>{golden.baseline.model || "Current model"}</span>
        {golden.baseline.provider && (
          <>
            <span>·</span>
            <span>{golden.baseline.provider}</span>
          </>
        )}
        <span>·</span>
        <span>{golden.baseline.structure.tools.length} expected tools</span>
        <span>·</span>
        <span>
          {(golden.assertions.response ? 1 : 0) + golden.assertions.tools.length} correctness checks
        </span>
        <span>·</span>
        <Link
          to={`/chat?session=${encodeURIComponent(golden.baseline.sessionId)}`}
          className="text-indigo-300 hover:text-indigo-200"
        >
          View source chat (turn {golden.baseline.turnIndex + 1})
        </Link>
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
          <span className="text-[11px] text-gray-600">No tools used — text-only response</span>
        )}
      </div>

      {latestRun && (
        <div className={cn("mt-3 rounded-md border px-3 py-2", runTone(latestRun.status))}>
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 font-medium text-gray-200">
              {statusIcon(latestRun.status)}
              {latestRun.status === "passed"
                ? "All checks passed"
                : latestRun.status === "failed"
                  ? "Behavior diverged"
                  : latestRun.status === "error"
                    ? "Replay error"
                    : "Running"}
            </span>
            {latestRun.score !== null && (
              <span className="text-gray-400" title="How closely the replay matched the saved run">
                {latestRun.score}% match
              </span>
            )}
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
  const [labView, setLabView] = useState<
    "data" | "computer-use" | "benchmarks" | "leaderboard" | "evals"
  >("data");
  const [busyGoldenId, setBusyGoldenId] = useState<string | null>(null);
  const [sanitizeExport, setSanitizeExport] = useState(true);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const configQuery = useQuery({
    queryKey: ["config", "lab"],
    queryFn: async () => {
      const response = await settingsApi.getConfig();
      if (!response.success) throw new Error(response.error || "Failed to load Lab settings");
      return readLabSettings(response.data?.lab);
    },
  });
  const labSettings = configQuery.data ?? readLabSettings(undefined);
  const query = useQuery({
    queryKey: ["agent-evals"],
    queryFn: async () => {
      const response = await evalsApi.list();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load evals");
      return response.data;
    },
    enabled: configQuery.isSuccess && labSettings.enabled,
  });
  useEffect(() => {
    if (configQuery.data) setSanitizeExport(configQuery.data.sanitizeExportsByDefault);
  }, [configQuery.data]);
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
  const exportData = useMutation({
    mutationFn: async (format: "bundle" | "jsonl") => {
      const response = await evalsApi.export(format, format === "jsonl" && sanitizeExport);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Export failed");
      }
      const blob = new Blob([response.data.content], {
        type: response.data.mimeType,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return response.data.count;
    },
    onSuccess: (count) =>
      setTransferMessage(`Exported ${count} golden test${count === 1 ? "" : "s"}`),
    onError: (error) =>
      setTransferMessage(error instanceof Error ? error.message : "Export failed"),
  });
  const importData = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 25_000_000) throw new Error("Eval suite exceeds 25 MB");
      const bundle = JSON.parse(await file.text()) as unknown;
      const response = await evalsApi.import(bundle);
      if (!response.success || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Import failed");
      }
      return response.data.count;
    },
    onSuccess: (count) => {
      setTransferMessage(`Imported ${count} golden test${count === 1 ? "" : "s"}`);
      void queryClient.invalidateQueries({ queryKey: ["agent-evals"] });
    },
    onError: (error) =>
      setTransferMessage(error instanceof Error ? error.message : "Import failed"),
  });
  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) importData.mutate(file);
  };
  const goldens = query.data?.goldens ?? [];
  const insights = useMemo(() => {
    let passing = 0;
    let failing = 0;
    let notRun = 0;
    let scoreTotal = 0;
    let scored = 0;
    const divergenceCounts = new Map<string, number>();
    for (const golden of goldens) {
      const run = latestRuns.get(golden.id);
      if (!run || run.status === "running") notRun += 1;
      else if (run.status === "passed") passing += 1;
      else failing += 1;
      if (typeof run?.score === "number") {
        scoreTotal += run.score;
        scored += 1;
      }
      for (const difference of run?.comparison?.differences ?? []) {
        divergenceCounts.set(difference.path, (divergenceCounts.get(difference.path) ?? 0) + 1);
      }
    }
    const completed = passing + failing;
    return {
      total: goldens.length,
      passing,
      failing,
      notRun,
      coverage: goldens.length === 0 ? 0 : Math.round((completed / goldens.length) * 100),
      passRate: completed === 0 ? 0 : Math.round((passing / completed) * 100),
      averageScore: scored === 0 ? 0 : Math.round(scoreTotal / scored),
      divergences: [...divergenceCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4),
    };
  }, [goldens, latestRuns]);

  if (configQuery.isLoading) {
    return (
      <PageLayout title="Lab" subtitle="Curate agent data, inspect traces, and measure behavior">
        <div className="flex min-h-[360px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[rgb(var(--accent-primary))]" />
        </div>
      </PageLayout>
    );
  }

  if (configQuery.isError) {
    return (
      <PageLayout title="Lab" subtitle="Curate agent data, inspect traces, and measure behavior">
        <div className="flex min-h-[420px] items-center justify-center text-center">
          <div className="max-w-md">
            <AlertCircle className="mx-auto h-10 w-10 text-red-300" />
            <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
              Lab settings unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              {configQuery.error instanceof Error
                ? configQuery.error.message
                : "The gateway did not return the Lab configuration."}
            </p>
            <button
              type="button"
              onClick={() => void configQuery.refetch()}
              className="mt-4 inline-flex h-9 items-center rounded-md bg-[rgb(var(--accent-primary))] px-3 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (!labSettings.enabled) {
    return (
      <PageLayout title="Lab" subtitle="Curate agent data, inspect traces, and measure behavior">
        <div className="flex min-h-[420px] items-center justify-center text-center">
          <div className="max-w-md">
            <FlaskConical className="mx-auto h-10 w-10 text-[var(--text-muted)]" />
            <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
              Lab is disabled
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Existing traces and golden tests remain stored. Enable Lab to capture turns, run
              benchmarks, replay evals, or export training datasets.
            </p>
            <Link
              to="/settings?section=lab"
              className="mt-4 inline-flex h-9 items-center rounded-md bg-[rgb(var(--accent-primary))] px-3 text-sm font-medium text-white"
            >
              Open Lab settings
            </Link>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Lab"
      subtitle="Curate agent data, inspect reasoning traces, and measure behavior"
      actions={
        labView === "evals" ? (
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
        ) : null
      }
    >
      <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-white/[0.025] p-1">
        {(
          [
            { key: "data", label: "Data", icon: Database },
            { key: "computer-use", label: "Computer Use", icon: MousePointer2 },
            { key: "benchmarks", label: "Benchmark", icon: Gauge },
            { key: "leaderboard", label: "Leaderboard", icon: Trophy },
            { key: "evals", label: "Evals", icon: FlaskConical },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setLabView(tab.key)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-[12px] transition-colors",
              labView === tab.key ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-200"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>
      {labView === "data" ? (
        <TraceDatasetPanel
          defaultFormat={labSettings.defaultExportFormat}
          defaultSanitize={labSettings.sanitizeExportsByDefault}
        />
      ) : labView === "computer-use" ? (
        <ComputerUseDatasetPanel />
      ) : labView === "benchmarks" ? (
        <BenchmarkPanel />
      ) : labView === "leaderboard" ? (
        <LeaderboardPanel />
      ) : (
        <>
          <EvalsExplainer />
          {!labSettings.goldenTurnsEnabled && (
            <div className="mb-4 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2.5 text-xs text-[var(--text-muted)]">
              Golden turn actions are disabled. Existing tests remain available for replay and
              export.
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-gray-100">Portable eval data</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Suite backups can be imported later. JSONL is ready for analysis and training
                pipelines.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex h-8 items-center gap-2 px-1 text-[11px] text-gray-300"
                title="Remove prompt content, workspace paths, tool arguments, and tool results from JSONL"
              >
                <Switch
                  checked={sanitizeExport}
                  onChange={setSanitizeExport}
                  ariaLabel="Redact JSONL"
                />
                <span>Redact JSONL</span>
              </div>
              <button
                type="button"
                onClick={() => exportData.mutate("bundle")}
                disabled={goldens.length === 0 || exportData.isPending}
                title="Full replayable backup. May contain prompts, paths, and tool output."
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[11px] text-gray-200 hover:bg-white/[0.06] disabled:opacity-40"
              >
                <FileJson className="h-3.5 w-3.5" />
                Suite JSON
              </button>
              <button
                type="button"
                onClick={() => exportData.mutate("jsonl")}
                disabled={goldens.length === 0 || exportData.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[11px] text-gray-200 hover:bg-white/[0.06] disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Trajectory JSONL
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importData.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[11px] text-gray-200 hover:bg-white/[0.06] disabled:opacity-40"
              >
                {importData.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Import suite
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
            {transferMessage && (
              <p className="w-full text-right text-[11px] text-gray-400">{transferMessage}</p>
            )}
          </div>
          {goldens.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                {
                  label: "Golden tests",
                  value: insights.total,
                  tone: "text-white",
                },
                {
                  label: "Coverage",
                  value: `${insights.coverage}%`,
                  tone: "text-blue-300",
                },
                {
                  label: "Pass rate",
                  value: `${insights.passRate}%`,
                  tone: "text-emerald-300",
                },
                {
                  label: "Average match",
                  value: `${insights.averageScore}%`,
                  tone: "text-indigo-300",
                },
                {
                  label: "Failing",
                  value: insights.failing,
                  tone: "text-red-300",
                },
                {
                  label: "Not run",
                  value: insights.notRun,
                  tone: "text-gray-300",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
                >
                  <p className={cn("text-lg font-semibold tabular-nums", stat.tone)}>
                    {stat.value}
                  </p>
                  <p className="text-[11px] text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
          {insights.divergences.length > 0 && (
            <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5">
              <p className="text-[12px] font-medium text-gray-200">Recurring divergences</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {insights.divergences.map(([path, count]) => (
                  <span
                    key={path}
                    className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px] text-gray-400"
                  >
                    {path} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}
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
              <div className="max-w-md">
                <FlaskConical className="mx-auto h-9 w-9 text-gray-600" />
                <h2 className="mt-4 text-base font-semibold text-white">No golden tests yet</h2>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  Golden tests are saved from real chats. Open a{" "}
                  <Link to="/chat" className="text-indigo-300 hover:text-indigo-200">
                    chat
                  </Link>{" "}
                  you're happy with, hover a completed assistant turn, and choose{" "}
                  <span className="font-medium text-gray-200">Save as golden</span>. It'll show up
                  here, ready to replay whenever you change your model, prompt, or tools.
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
        </>
      )}
    </PageLayout>
  );
}
