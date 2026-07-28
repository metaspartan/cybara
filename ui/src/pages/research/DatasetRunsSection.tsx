import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Database,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Link } from "react-router";
import { Switch } from "@/components/ui/Switch";
import type { AgentDatasetItem, AgentDatasetRun, ResearchExportFormat } from "@/lib/api";
import { labExportFormats } from "@/lib/labFormats";
import { cn } from "@/lib/utils";
import { DatasetUsageStat } from "./DatasetUsageStat";
import {
  datasetRunIsActive,
  datasetRunProviderLabel,
  formatDatasetDuration,
  formatDatasetElapsed,
  formatDatasetMetricCount,
} from "./datasetRunDisplay";

function statusLabel(run: AgentDatasetRun): string {
  if (run.cancelRequested && run.status === "running") return "Stopping";
  if (run.status === "completed" && run.failedItems > 0) return "Completed with errors";
  return run.status.charAt(0).toUpperCase() + run.status.slice(1);
}

function StatusIcon({ run }: { run: AgentDatasetRun }) {
  if (datasetRunIsActive(run))
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[rgb(var(--accent-primary))]" />;
  if (run.status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (run.status === "error") return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  return <CircleStop className="h-3.5 w-3.5 text-[var(--text-muted)]" />;
}

function DatasetItemRow({ item, run }: { item: AgentDatasetItem; run: AgentDatasetRun }) {
  const elapsed = formatDatasetElapsed(item.startedAt, item.completedAt);
  return (
    <div className="grid gap-2 border-t border-[var(--surface-border)] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <Link
          to={`/chat?session=${encodeURIComponent(item.sessionId)}`}
          className="line-clamp-1 text-[12px] font-medium text-[var(--text-primary)] hover:text-[rgb(var(--accent-primary))]"
        >
          {item.prompt}
        </Link>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-secondary)]">
          {item.trace?.responsePreview ||
            (item.status === "running"
              ? `Generating response${elapsed ? ` · ${elapsed}` : ""} / ${formatDatasetDuration(run.sampleTimeoutSeconds * 1000)} limit`
              : "No response captured")}
        </p>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          Prompt {item.promptIndex + 1} · Sample {item.sampleIndex + 1}
          {item.trace ? ` · ${item.trace.split} · quality ${item.trace.qualityScore}` : ""}
          {item.trace?.toolCallCount ? ` · ${item.trace.toolCallCount} tools` : ""}
          {item.error ? ` · ${item.error}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
        <span className="capitalize">{item.status}</span>
        {item.usage.totalTokens > 0 ? (
          <span>{formatDatasetMetricCount(item.usage.totalTokens)} tokens</span>
        ) : null}
        {item.usage.durationMs > 0 ? (
          <span>{formatDatasetDuration(item.usage.durationMs)}</span>
        ) : null}
      </div>
    </div>
  );
}

interface DatasetRunRowProps {
  detailsLoading: boolean;
  expanded: boolean;
  items: AgentDatasetItem[];
  run: AgentDatasetRun;
  onCancel: (runId: string) => void;
  onExport: (runId: string, card: boolean) => void;
  onRemove: (runId: string) => void;
  onRetry: (runId: string) => void;
  onSelect: (runId: string | null) => void;
}

function DatasetRunRow(props: DatasetRunRowProps) {
  const { run } = props;
  const finishedItems = run.completedItems + run.failedItems + run.cancelledItems;
  const progress = run.totalItems > 0 ? Math.round((finishedItems / run.totalItems) * 100) : 0;
  const provider = datasetRunProviderLabel(run.provider);
  const elapsed = formatDatasetElapsed(run.startedAt, run.completedAt);
  return (
    <div
      className={cn(
        "border-b border-[var(--surface-border)] last:border-b-0",
        props.expanded && "bg-[rgba(var(--accent-primary),0.035)]"
      )}
    >
      <div className="grid gap-1 px-3 py-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <button
          type="button"
          onClick={() => props.onSelect(props.expanded ? null : run.id)}
          className="grid min-w-0 gap-3 rounded-md px-1 py-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--accent-primary))] lg:grid-cols-[minmax(220px,1.25fr)_minmax(230px,1fr)] lg:items-center"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {props.expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--icon-muted)]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[var(--icon-muted)]" />
              )}
              <Bot className="h-3.5 w-3.5 text-[rgb(var(--accent-primary))]" />
              <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                {run.name}
              </span>
            </div>
            <p className="mt-1 truncate pl-[58px] text-[10px] text-[var(--text-muted)]">
              {run.model || "Default model"}
              {provider ? ` · ${provider}` : ""} · {run.totalItems} samples ·{" "}
              {formatDatasetMetricCount(run.maxOutputTokens)} max ·{" "}
              {formatDatasetDuration(run.sampleTimeoutSeconds * 1000)} limit
            </p>
          </div>
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 text-[10px]">
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <StatusIcon run={run} />
                {statusLabel(run)}
                {elapsed ? ` · ${elapsed}` : ""}
              </span>
              <span className="tabular-nums text-[var(--text-muted)]">
                {finishedItems}/{run.totalItems}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className="h-full rounded-full bg-[rgb(var(--accent-primary))] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </button>
        <div className="flex items-center justify-end gap-1">
          {run.completedItems > 0 ? (
            <button
              type="button"
              onClick={() => props.onExport(run.id, false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              title="Export generated traces"
              aria-label="Export generated traces"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {run.completedItems > 0 ? (
            <button
              type="button"
              onClick={() => props.onExport(run.id, true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              title="Download dataset card"
              aria-label="Download dataset card"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {datasetRunIsActive(run) ? (
            <button
              type="button"
              onClick={() => props.onCancel(run.id)}
              disabled={run.cancelRequested}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-amber-300 disabled:opacity-40"
              title="Stop scheduling samples"
              aria-label="Stop scheduling samples"
            >
              <CircleStop className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              {run.completedItems < run.totalItems ? (
                <button
                  type="button"
                  onClick={() => props.onRetry(run.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  title="Retry incomplete samples"
                  aria-label="Retry incomplete samples"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => props.onRemove(run.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-red-300"
                title="Remove run"
                aria-label="Remove run"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {props.expanded ? (
        <div className="border-t border-[var(--surface-border)]">
          <div className="grid grid-cols-2 gap-3 px-3 py-3 sm:grid-cols-4 lg:grid-cols-8">
            <DatasetUsageStat
              label="Input"
              value={formatDatasetMetricCount(run.usage.inputTokens)}
            />
            <DatasetUsageStat
              label="Output"
              value={formatDatasetMetricCount(run.usage.outputTokens)}
            />
            <DatasetUsageStat
              label="Cache read"
              value={formatDatasetMetricCount(run.usage.cachedInputTokens)}
            />
            <DatasetUsageStat
              label="Cache hit"
              value={run.usage.cacheHitRate === null ? "--" : `${run.usage.cacheHitRate}%`}
            />
            <DatasetUsageStat
              label="Model calls"
              value={formatDatasetMetricCount(run.usage.callCount)}
            />
            <DatasetUsageStat label="Runtime" value={formatDatasetDuration(run.usage.durationMs)} />
            <DatasetUsageStat
              label="Output speed"
              value={
                run.usage.tokensPerSecond === null ? "--" : `${run.usage.tokensPerSecond} tok/s`
              }
            />
            <DatasetUsageStat
              label="Average TTFT"
              value={
                run.usage.averageFirstTokenMs === null
                  ? "--"
                  : formatDatasetDuration(run.usage.averageFirstTokenMs)
              }
            />
          </div>
          {props.detailsLoading ? (
            <div className="border-t border-[var(--surface-border)] p-4 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-[var(--icon-muted)]" />
            </div>
          ) : null}
          {props.items.map((item) => (
            <DatasetItemRow key={item.id} item={item} run={run} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface DatasetRunsSectionProps {
  detailsLoading: boolean;
  error: unknown;
  format: ResearchExportFormat;
  items: AgentDatasetItem[];
  loading: boolean;
  runs: AgentDatasetRun[];
  sanitize: boolean;
  selectedRunId: string | null;
  onCancel: (runId: string) => void;
  onExport: (runId: string, card: boolean) => void;
  onFormatChange: (format: ResearchExportFormat) => void;
  onRemove: (runId: string) => void;
  onRetry: (runId: string) => void;
  onSanitizeChange: (sanitize: boolean) => void;
  onSelect: (runId: string | null) => void;
}

export function DatasetRunsSection(props: DatasetRunsSectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--surface-border)] px-3 py-2.5">
        <div>
          <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Dataset runs</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            Runs persist across navigation and gateway restarts. Multiple agents can generate data
            at once.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Dataset export format"
            value={props.format}
            onChange={(event) => props.onFormatChange(event.target.value as ResearchExportFormat)}
            className="themed-form-control h-8 rounded-md border px-2 text-[11px]"
          >
            {labExportFormats.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--surface-border)] px-2">
            <Switch
              checked={props.sanitize}
              onChange={props.onSanitizeChange}
              ariaLabel="Redact dataset exports"
            />
            <span className="text-[10px] text-[var(--text-muted)]">Redact</span>
          </div>
        </div>
      </div>
      {props.loading ? (
        <div className="p-6 text-center text-sm text-[var(--text-muted)]">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : null}
      {props.error ? (
        <div className="flex items-center gap-2 p-4 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" />
          {props.error instanceof Error ? props.error.message : "Failed to load runs"}
        </div>
      ) : null}
      {!props.loading && !props.error && props.runs.length === 0 ? (
        <div className="p-10 text-center">
          <Database className="mx-auto h-8 w-8 text-[var(--icon-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
            No generated datasets yet
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Add prompts above to create a persistent teacher-data run.
          </p>
        </div>
      ) : null}
      {props.runs.map((run) => (
        <DatasetRunRow
          key={run.id}
          run={run}
          expanded={props.selectedRunId === run.id}
          detailsLoading={props.detailsLoading}
          items={props.selectedRunId === run.id ? props.items : []}
          onSelect={props.onSelect}
          onCancel={props.onCancel}
          onExport={props.onExport}
          onRemove={props.onRemove}
          onRetry={props.onRetry}
        />
      ))}
    </section>
  );
}
