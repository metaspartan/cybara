import { Switch } from "@/components/ui/Switch";
import { type ResearchExportFormat, type ResearchTraceSummary, researchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Database,
  Download,
  Loader2,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const exportFormats: Array<{
  value: ResearchExportFormat;
  label: string;
  description: string;
}> = [
  {
    value: "cybara_trace",
    label: "Full trajectories",
    description: "Prompts, responses, observable reasoning, and complete tool I/O",
  },
  {
    value: "trl_sft",
    label: "Hugging Face / TRL SFT",
    description: "Messages and reconstructed tool turns for supervised fine-tuning",
  },
  {
    value: "long_context",
    label: "Long-context QA",
    description: "Prompt, tool observations, and final completion",
  },
  {
    value: "prompt_completion",
    label: "Prompt / completion",
    description: "Minimal pairs for analysis and general training pipelines",
  },
];

function download(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function qualityTone(score: number): string {
  if (score >= 90) return "text-emerald-300";
  if (score >= 70) return "text-amber-300";
  return "text-red-300";
}

function TraceRow({
  trace,
  selected,
  onToggle,
}: {
  trace: ResearchTraceSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-white/10 px-3 py-3 last:border-b-0 lg:grid-cols-[28px_minmax(0,1fr)_210px]",
        selected && "bg-indigo-400/[0.05]"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "mt-0.5 flex h-5 w-5 items-center justify-center rounded border transition-colors",
          selected
            ? "border-indigo-400 bg-indigo-500 text-white"
            : "border-white/10 text-transparent hover:border-gray-500"
        )}
        aria-label={selected ? "Remove trace from selection" : "Add trace to selection"}
        aria-pressed={selected}
      >
        <Check className="h-3 w-3" />
      </button>
      <div className="min-w-0">
        <Link
          to={`/chat?session=${encodeURIComponent(trace.sessionId)}`}
          className="line-clamp-1 text-[13px] font-medium text-white hover:text-indigo-300"
        >
          {trace.promptPreview || "Untitled trace"}
        </Link>
        <p className="mt-1 line-clamp-1 text-[12px] text-gray-500">
          {trace.responsePreview || "No final response captured"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500 lg:hidden">
          <TraceMetadata trace={trace} />
        </div>
      </div>
      <div className="hidden flex-wrap content-start items-center justify-end gap-1.5 text-[10px] text-gray-500 lg:flex">
        <TraceMetadata trace={trace} />
      </div>
    </div>
  );
}

function TraceMetadata({ trace }: { trace: ResearchTraceSummary }) {
  return (
    <>
      <span className="rounded border border-white/10 px-1.5 py-0.5">
        {trace.model || trace.provider || "Unknown model"}
      </span>
      <span className="rounded border border-white/10 px-1.5 py-0.5">
        {trace.toolCallCount} tools
      </span>
      {trace.hasObservableReasoning && (
        <span className="rounded border border-white/10 px-1.5 py-0.5">reasoning</span>
      )}
      <span
        className={cn(
          "rounded border border-white/10 px-1.5 py-0.5",
          qualityTone(trace.qualityScore)
        )}
      >
        {trace.qualityScore}% quality
      </span>
      <span className="uppercase">{trace.split}</span>
    </>
  );
}

type TraceFilter = "all" | "clean" | "reasoning" | "tools" | "train" | "validation" | "test";

const traceFilters: Array<{ value: TraceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "clean", label: "Clean" },
  { value: "reasoning", label: "Has reasoning" },
  { value: "tools", label: "Uses tools" },
  { value: "train", label: "Train" },
  { value: "validation", label: "Validation" },
  { value: "test", label: "Test" },
];

function matchesTraceFilter(trace: ResearchTraceSummary, filter: TraceFilter): boolean {
  if (filter === "clean") return trace.qualityFlags.length === 0;
  if (filter === "reasoning") return trace.hasObservableReasoning;
  if (filter === "tools") return trace.toolCallCount > 0;
  if (filter === "train" || filter === "validation" || filter === "test") {
    return trace.split === filter;
  }
  return true;
}

export function TraceDatasetPanel() {
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<TraceFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [format, setFormat] = useState<ResearchExportFormat>("cybara_trace");
  const [sanitize, setSanitize] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["research-traces"],
    queryFn: async () => {
      const response = await researchApi.traces();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load research traces");
      }
      return response.data;
    },
  });
  const filtered = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    const traces = (query.data?.traces ?? []).filter((trace) => matchesTraceFilter(trace, filter));
    if (!needle) return traces;
    return traces.filter((trace) =>
      [trace.promptPreview, trace.responsePreview, trace.provider, trace.model, trace.agentId]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [query.data?.traces, queryText, filter]);
  const exporter = useMutation({
    mutationFn: async () => {
      const response = await researchApi.export(format, sanitize, [...selected]);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Export failed");
      }
      download(response.data.content, response.data.filename, response.data.mimeType);
      return response.data.count;
    },
    onSuccess: (count) => setMessage(`Exported ${count} trace${count === 1 ? "" : "s"}`),
    onError: (error) => setMessage(error instanceof Error ? error.message : "Export failed"),
  });
  const stats = query.data?.stats;
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((trace) => selected.has(trace.id));
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filtered.forEach((trace) => next.delete(trace.id));
      else filtered.forEach((trace) => next.add(trace.id));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Captured traces", value: query.data?.total ?? 0, icon: Database },
          { label: "Tool calls", value: stats?.toolCalls ?? 0, icon: Wrench },
          { label: "Reasoning available", value: stats?.reasoningTraces ?? 0, icon: BrainCircuit },
          { label: "Clean traces", value: stats?.cleanTraces ?? 0, icon: Sparkles },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xl font-semibold tabular-nums text-white">{item.value}</p>
              <item.icon className="h-4 w-4 text-gray-500" />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_240px_auto] xl:items-end">
          <div>
            <label htmlFor="research-format" className="text-[11px] font-medium text-gray-300">
              Dataset format
            </label>
            <select
              id="research-format"
              value={format}
              onChange={(event) => setFormat(event.target.value as ResearchExportFormat)}
              className="mt-1 h-9 w-full rounded-md border border-white/10 bg-black/20 px-2.5 text-[12px] text-white outline-none focus:border-indigo-400"
            >
              {exportFormats.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-gray-500">
              {exportFormats.find((item) => item.value === format)?.description}
            </p>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-2.5">
            <Switch
              checked={sanitize}
              onChange={setSanitize}
              ariaLabel="Redact sensitive trace data"
            />
            <span className="text-[11px] text-gray-300">Redact sensitive content</span>
          </div>
          <button
            type="button"
            onClick={() => exporter.mutate()}
            disabled={(query.data?.total ?? 0) === 0 || exporter.isPending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-indigo-500 px-3 text-[12px] font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {exporter.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export {selected.size > 0 ? selected.size : "all"}
          </button>
        </div>
        <div className="mt-3 flex items-start gap-2 border-t border-white/10 pt-3 text-[11px] leading-5 text-gray-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Reasoning exports contain only text exposed by the provider. Hidden reasoning is never
            inferred. Splits remain stable across exports so experiments are reproducible.
          </p>
        </div>
        {message && <p className="mt-2 text-right text-[11px] text-gray-300">{message}</p>}
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <button
            type="button"
            onClick={toggleAll}
            className="h-8 rounded-md border border-white/10 px-2.5 text-[11px] text-gray-300 hover:bg-white/[0.05]"
          >
            {allFilteredSelected ? "Clear visible" : "Select visible"}
          </button>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-500" />
            <input
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search prompts, responses, models, or agents"
              className="h-8 w-full rounded-md border border-white/10 bg-black/20 pl-8 pr-3 text-[11px] text-white outline-none placeholder:text-gray-500 focus:border-indigo-400"
            />
          </div>
          <span className="text-[10px] text-gray-500">
            {selected.size > 0 ? `${selected.size} selected · ` : ""}
            {filtered.length} shown
          </span>
          <div className="flex w-full flex-wrap gap-1 pt-1">
            {traceFilters.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={cn(
                  "h-6 rounded-full border px-2 text-[10px] transition-colors",
                  filter === item.value
                    ? "border-indigo-400/40 bg-indigo-400/15 text-indigo-200"
                    : "border-white/10 text-gray-500 hover:text-gray-200"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {query.isLoading ? (
          <div className="space-y-px p-3">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded bg-white/[0.05]" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="p-6 text-center text-sm text-red-300">
            {query.error instanceof Error ? query.error.message : "Failed to load traces"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Database className="mx-auto h-8 w-8 text-gray-500" />
            <p className="mt-3 text-sm font-medium text-white">No traces found</p>
            <p className="mt-1 text-[12px] text-gray-500">
              Completed agent turns appear here automatically.
            </p>
          </div>
        ) : (
          filtered.map((trace) => (
            <TraceRow
              key={trace.id}
              trace={trace}
              selected={selected.has(trace.id)}
              onToggle={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(trace.id)) next.delete(trace.id);
                  else next.add(trace.id);
                  return next;
                })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
