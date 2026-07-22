import { Switch } from "@/components/ui/Switch";
import {
  computerUseApi,
  type ComputerUseTrajectoryDetail,
  type ComputerUseTrajectorySummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Image,
  Loader2,
  MonitorUp,
  MousePointer2,
  Play,
  ShieldAlert,
  Trash2,
  Video,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function download(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)} sec`;
  return `${Math.round(durationMs / 60_000)} min`;
}

function statusTone(status: ComputerUseTrajectorySummary["status"]): string {
  if (status === "recording") return "border-red-400/25 bg-red-400/10 text-red-200";
  if (status === "completed") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (status === "error") return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  return "border-white/10 bg-white/[0.04] text-gray-300";
}

function trajectoryLabel(surface: ComputerUseTrajectorySummary["surface"]): string {
  if (surface === "ios_simulator") return "iOS Simulator run";
  if (surface === "android_emulator") return "Android Emulator run";
  return "Computer-use run";
}

function trajectoryTarget(surface: ComputerUseTrajectorySummary["surface"]): string {
  if (surface === "ios_simulator") return "iOS Simulator";
  if (surface === "android_emulator") return "Android Emulator";
  return "desktop";
}

function TurnTimeline({ trajectory }: { trajectory: ComputerUseTrajectoryDetail }) {
  return (
    <div className="border-t border-white/10 bg-black/15 px-4 py-3">
      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {trajectory.turns.map((turn) => (
          <div
            key={turn.index}
            className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-white/[0.035]"
          >
            <span className="font-mono tabular-nums text-gray-600">{turn.index}</span>
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-300">{turn.tool.replace(/_/g, " ")}</p>
              <p className="truncate font-mono text-[10px] text-gray-600">
                {JSON.stringify(turn.arguments)}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              {turn.hasAppState ? <Eye className="h-3 w-3" aria-label="App state" /> : null}
              {turn.hasScreenshot ? <Image className="h-3 w-3" aria-label="Screenshot" /> : null}
              {turn.clickPoint ? (
                <MousePointer2 className="h-3 w-3" aria-label="Click point" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrajectoryRow({
  trajectory,
  selected,
  expanded,
  detail,
  busy,
  replayPending,
  onToggle,
  onExpand,
  onReplay,
  onConfirmReplay,
  onCancelReplay,
  onDelete,
}: {
  trajectory: ComputerUseTrajectorySummary;
  selected: boolean;
  expanded: boolean;
  detail?: ComputerUseTrajectoryDetail;
  busy: boolean;
  replayPending: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onReplay: () => void;
  onConfirmReplay: () => void;
  onCancelReplay: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            selected
              ? "border-indigo-400 bg-indigo-500 text-white"
              : "border-white/10 text-transparent hover:border-gray-500"
          )}
          aria-label={selected ? "Remove trajectory from selection" : "Select trajectory"}
          aria-pressed={selected}
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onExpand}
          className="rounded p-0.5 text-gray-600 hover:text-gray-300"
          aria-label={expanded ? "Collapse trajectory" : "Expand trajectory"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/chat?session=${encodeURIComponent(trajectory.sessionId)}`}
              className="max-w-md truncate text-[13px] font-medium text-gray-100 hover:text-indigo-300"
            >
              {trajectory.sessionId.startsWith("replay:")
                ? `Replay · ${trajectoryLabel(trajectory.surface)}`
                : trajectoryLabel(trajectory.surface)}
            </Link>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                statusTone(trajectory.status)
              )}
            >
              {trajectory.status}
            </span>
            {trajectory.replayOf ? <span className="text-[10px] text-gray-600">replay</span> : null}
          </div>
          <p className="mt-1 text-[10px] text-gray-600">
            {new Date(trajectory.createdAt).toLocaleString()} ·{" "}
            {durationLabel(trajectory.durationMs)}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span>{trajectory.turnCount} actions</span>
          <span>{trajectory.screenshotCount} frames</span>
          <span>{trajectory.clickCount} clicks</span>
          {trajectory.videoAvailable ? (
            <Video className="h-3.5 w-3.5" aria-label="Video available" />
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReplay}
            disabled={busy || trajectory.status === "recording" || trajectory.turnCount === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-gray-400 hover:bg-white/[0.06] hover:text-gray-100 disabled:opacity-35"
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
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-35"
            aria-label="Delete trajectory"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {replayPending ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-400/15 bg-amber-400/[0.06] px-4 py-2.5">
          <p className="flex items-center gap-2 text-[11px] text-amber-100/90">
            <ShieldAlert className="h-3.5 w-3.5" />
            Replay repeats the recorded actions on the current{" "}
            {trajectoryTarget(trajectory.surface)}.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancelReplay}
              className="h-7 px-2 text-[11px] text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmReplay}
              className="h-7 rounded-md bg-amber-500 px-2.5 text-[11px] font-medium text-black hover:bg-amber-400"
            >
              Replay actions
            </button>
          </div>
        </div>
      ) : null}
      {expanded && detail ? <TurnTimeline trajectory={detail} /> : null}
    </div>
  );
}

export function ComputerUseDatasetPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replayPendingId, setReplayPendingId] = useState<string | null>(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [redact, setRedact] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["computer-use-trajectories"],
    queryFn: async () => {
      const response = await computerUseApi.trajectories();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load computer-use trajectories");
      return response.data;
    },
    refetchInterval: (current) => (current.state.data?.activeId ? 1_000 : 10_000),
  });
  const detail = useQuery({
    queryKey: ["computer-use-trajectory", expandedId],
    enabled: expandedId !== null,
    queryFn: async () => {
      if (!expandedId) return null;
      const response = await computerUseApi.trajectory(expandedId);
      if (!response.success || !response.data?.trajectory)
        throw new Error(response.error || "Failed to load trajectory");
      return response.data.trajectory;
    },
  });
  const configure = useMutation({
    mutationFn: computerUseApi.configureTrajectories,
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["computer-use-trajectories"],
      }),
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Could not update capture settings"),
  });
  const replay = useMutation({
    mutationFn: (id: string) => computerUseApi.replayTrajectory(id),
    onSuccess: (response) => {
      setReplayPendingId(null);
      setMessage(response.data?.result || "Replay completed");
      void queryClient.invalidateQueries({
        queryKey: ["computer-use-trajectories"],
      });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Replay failed"),
  });
  const remove = useMutation({
    mutationFn: computerUseApi.deleteTrajectory,
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["computer-use-trajectories"],
      }),
  });
  const exporter = useMutation({
    mutationFn: async () => {
      const response = await computerUseApi.exportTrajectories([...selected], includeMedia, redact);
      if (!response.success || !response.data) throw new Error(response.error || "Export failed");
      download(response.data.content, response.data.filename, response.data.mimeType);
      return response.data.count;
    },
    onSuccess: (count) => setMessage(`Exported ${count} interaction run${count === 1 ? "" : "s"}`),
    onError: (error) => setMessage(error instanceof Error ? error.message : "Export failed"),
  });
  const trajectories = query.data?.trajectories ?? [];
  const stats = useMemo(
    () => ({
      runs: trajectories.length,
      actions: trajectories.reduce((total, item) => total + item.turnCount, 0),
      frames: trajectories.reduce((total, item) => total + item.screenshotCount, 0),
      failures: trajectories.filter((item) => item.status === "error").length,
    }),
    [trajectories]
  );
  const settings = query.data?.settings;

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <MonitorUp className="h-4 w-4 text-indigo-300" />
            <h2 className="text-sm font-semibold text-gray-100">Interaction trajectories</h2>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-gray-500">
            Capture desktop, iOS Simulator, and Android Emulator actions with screenshots and click
            coordinates for replay, debugging, and multimodal datasets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-gray-300">
            <Switch
              checked={settings?.trajectoryCaptureEnabled ?? false}
              onChange={(enabled) => configure.mutate({ trajectoryCaptureEnabled: enabled })}
              ariaLabel="Capture interaction trajectories"
            />
            Capture future runs
          </label>
          <label className="flex items-center gap-2 text-[11px] text-gray-300">
            <Switch
              checked={settings?.trajectoryVideoEnabled ?? false}
              disabled={!settings?.trajectoryCaptureEnabled}
              onChange={(enabled) => configure.mutate({ trajectoryVideoEnabled: enabled })}
              ariaLabel="Record computer-use video"
            />
            Include video
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 border-b border-white/10 sm:grid-cols-4">
        {[
          ["Runs", stats.runs],
          ["Actions", stats.actions],
          ["Frames", stats.frames],
          ["Errors", stats.failures],
        ].map(([label, value]) => (
          <div key={label} className="border-r border-white/10 px-4 py-3 last:border-r-0">
            <p className="text-lg font-semibold tabular-nums text-gray-100">{value}</p>
            <p className="text-[10px] uppercase tracking-wide text-gray-600">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
        <p className="text-[11px] text-gray-600">
          {settings?.trajectoryCaptureEnabled
            ? "New interaction runs are being captured."
            : "Capture is disabled until you enable it above."}{" "}
          Redaction removes recognized credentials from exported text; screenshots may still contain
          sensitive content.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[10px] text-gray-400">
            <Switch checked={redact} onChange={setRedact} ariaLabel="Redact trajectory exports" />
            Redact
          </label>
          <label className="flex items-center gap-2 text-[10px] text-gray-400">
            <Switch
              checked={includeMedia}
              onChange={setIncludeMedia}
              ariaLabel="Include media in trajectory export"
            />
            Include media
          </label>
          <button
            type="button"
            onClick={() => exporter.mutate()}
            disabled={trajectories.length === 0 || exporter.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[11px] text-gray-300 hover:bg-white/[0.06] disabled:opacity-35"
          >
            {exporter.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Export {selected.size > 0 ? selected.size : "all"}
          </button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-md bg-white/[0.035]" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="p-4 text-[12px] text-red-300">
          {query.error instanceof Error ? query.error.message : "Failed to load trajectories"}
        </p>
      ) : trajectories.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <MousePointer2 className="mx-auto h-7 w-7 text-gray-700" />
          <p className="mt-3 text-[13px] font-medium text-gray-300">No captured interaction runs</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Enable capture, then let an agent use desktop or simulator controls in a chat.
          </p>
        </div>
      ) : (
        trajectories.map((trajectory) => (
          <TrajectoryRow
            key={trajectory.id}
            trajectory={trajectory}
            selected={selected.has(trajectory.id)}
            expanded={expandedId === trajectory.id}
            detail={expandedId === trajectory.id ? (detail.data ?? undefined) : undefined}
            busy={
              (replay.isPending && replay.variables === trajectory.id) ||
              (remove.isPending && remove.variables === trajectory.id)
            }
            replayPending={replayPendingId === trajectory.id}
            onToggle={() =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(trajectory.id)) next.delete(trajectory.id);
                else next.add(trajectory.id);
                return next;
              })
            }
            onExpand={() =>
              setExpandedId((current) => (current === trajectory.id ? null : trajectory.id))
            }
            onReplay={() => setReplayPendingId(trajectory.id)}
            onConfirmReplay={() => replay.mutate(trajectory.id)}
            onCancelReplay={() => setReplayPendingId(null)}
            onDelete={() => remove.mutate(trajectory.id)}
          />
        ))
      )}
      {message ? (
        <p className="border-t border-white/10 px-4 py-2 text-right text-[11px] text-gray-400">
          {message}
        </p>
      ) : null}
    </section>
  );
}
