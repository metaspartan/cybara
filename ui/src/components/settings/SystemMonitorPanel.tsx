import { Activity, Cpu, Gauge, HardDrive, MemoryStick, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useHealth, useInfo, useSystemMonitor, type SystemMonitorData } from "@/hooks/useApi";
import { formatBytes, formatPct, formatStorageBytes, formatUptime } from "@/lib/settingsFormat";

const MAX_SAMPLES = 72;
const MEMORY_SERIES_COLOR = "#0d9488";

interface MonitorSample {
  timestamp: number;
  cpuPct: number;
  memoryPct: number;
  processCpuPct: number;
  processRssBytes: number;
}

const sampleHistory: MonitorSample[] = [];

function recordSample(data: SystemMonitorData): MonitorSample[] {
  const timestamp = Date.parse(data.timestamp);
  if (
    Number.isFinite(timestamp) &&
    sampleHistory[sampleHistory.length - 1]?.timestamp !== timestamp
  ) {
    sampleHistory.push({
      timestamp,
      cpuPct: clampPct(data.cpu.usagePct),
      memoryPct: clampPct(data.memory.usedPct),
      processCpuPct: clampPct(data.process.cpuUsagePct),
      processRssBytes: data.process.memory.rssBytes,
    });
    if (sampleHistory.length > MAX_SAMPLES) {
      sampleHistory.splice(0, sampleHistory.length - MAX_SAMPLES);
    }
  }
  return [...sampleHistory];
}

function clampPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function meterSeverityColor(pct: number): string {
  if (pct >= 90) return "var(--context-ring-danger, #dc2626)";
  if (pct >= 70) return "var(--context-ring-warn, #d97706)";
  return "rgb(var(--accent-primary))";
}

function meterTrackColor(pct: number): string {
  if (pct >= 90) return "color-mix(in srgb, var(--context-ring-danger, #dc2626) 18%, transparent)";
  if (pct >= 70) return "color-mix(in srgb, var(--context-ring-warn, #d97706) 18%, transparent)";
  return "rgba(var(--accent-primary), 0.16)";
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 240;
  const height = 36;
  if (values.length < 2) {
    return <div className="h-9 w-full rounded bg-[var(--surface-border)] opacity-30" aria-hidden />;
  }
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - 3 - (value / max) * (height - 6),
  }));
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-9 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={area} fill={color} opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  spark,
  sparkColor,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  detail: string;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={detail}>
        {detail}
      </p>
      {spark && sparkColor ? (
        <div className="mt-3">
          <Sparkline values={spark} color={sparkColor} />
        </div>
      ) : (
        <div className="mt-3 h-9" aria-hidden />
      )}
    </div>
  );
}

function Meter({
  label,
  ariaLabel,
  pct,
  detail,
}: {
  label: React.ReactNode;
  ariaLabel: string;
  pct: number;
  detail: string;
}) {
  const clamped = clampPct(pct);
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1 text-xs font-medium text-[var(--text-muted)]">{label}</div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
          {formatPct(clamped)}
        </p>
      </div>
      <div
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: meterTrackColor(clamped) }}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${clamped}%`, background: meterSeverityColor(clamped) }}
        />
      </div>
      <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

function UsageChart({ samples }: { samples: MonitorSample[] }) {
  const width = 720;
  const height = 220;
  const padTop = 10;
  const padBottom = 22;
  const padLeft = 34;
  const padRight = 10;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const scaleX = (index: number) =>
    padLeft + (samples.length <= 1 ? plotWidth : (index / (samples.length - 1)) * plotWidth);
  const scaleY = (pct: number) => padTop + plotHeight - (clampPct(pct) / 100) * plotHeight;

  const buildLine = (pick: (sample: MonitorSample) => number) =>
    samples
      .map(
        (sample, index) =>
          `${index === 0 ? "M" : "L"} ${scaleX(index).toFixed(1)} ${scaleY(pick(sample)).toFixed(1)}`
      )
      .join(" ");

  const cpuLine = buildLine((sample) => sample.cpuPct);
  const memoryLine = buildLine((sample) => sample.memoryPct);
  const cpuArea =
    samples.length > 1
      ? `${cpuLine} L ${scaleX(samples.length - 1).toFixed(1)} ${padTop + plotHeight} L ${padLeft} ${padTop + plotHeight} Z`
      : "";
  const gridLevels = [0, 25, 50, 75, 100];
  const cpuColor = "rgb(var(--accent-primary))";
  const hovered = hoverIndex !== null ? samples[hoverIndex] : null;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (samples.length < 2 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = Math.min(1, Math.max(0, (relative - padLeft) / plotWidth));
    setHoverIndex(Math.round(ratio * (samples.length - 1)));
  };

  if (samples.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--glass-surface,rgba(255,255,255,0.02))] text-sm text-[var(--text-muted)]">
        Collecting samples — live history appears after a few refreshes
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="CPU and memory usage over the recent sample window"
      >
        {gridLevels.map((level) => (
          <g key={level}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={scaleY(level)}
              y2={scaleY(level)}
              stroke="var(--surface-border)"
              strokeWidth={1}
            />
            <text
              x={padLeft - 6}
              y={scaleY(level) + 3}
              textAnchor="end"
              className="fill-[var(--text-muted)] text-[10px] tabular-nums"
            >
              {level}
            </text>
          </g>
        ))}
        <path d={cpuArea} fill={cpuColor} opacity={0.08} />
        <path
          d={memoryLine}
          fill="none"
          stroke={MEMORY_SERIES_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={cpuLine}
          fill="none"
          stroke={cpuColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hovered ? (
          <g>
            <line
              x1={scaleX(hoverIndex ?? 0)}
              x2={scaleX(hoverIndex ?? 0)}
              y1={padTop}
              y2={padTop + plotHeight}
              stroke="var(--text-muted)"
              strokeWidth={1}
              opacity={0.5}
            />
            <circle
              cx={scaleX(hoverIndex ?? 0)}
              cy={scaleY(hovered.cpuPct)}
              r={4}
              fill={cpuColor}
              stroke="var(--surface-panel)"
              strokeWidth={2}
            />
            <circle
              cx={scaleX(hoverIndex ?? 0)}
              cy={scaleY(hovered.memoryPct)}
              r={4}
              fill={MEMORY_SERIES_COLOR}
              stroke="var(--surface-panel)"
              strokeWidth={2}
            />
          </g>
        ) : null}
        <text x={padLeft} y={height - 6} className="fill-[var(--text-muted)] text-[10px]">
          {formatClock(samples[0].timestamp)}
        </text>
        <text
          x={width - padRight}
          y={height - 6}
          textAnchor="end"
          className="fill-[var(--text-muted)] text-[10px]"
        >
          {formatClock(samples[samples.length - 1].timestamp)}
        </text>
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2 text-xs shadow-lg"
          style={{
            left: `calc(${((scaleX(hoverIndex ?? 0) / width) * 100).toFixed(1)}% ${
              (hoverIndex ?? 0) > samples.length / 2 ? "- 100% - 12px" : "+ 12px"
            })`,
          }}
        >
          <p className="font-medium text-[var(--text-primary)]">{formatClock(hovered.timestamp)}</p>
          <p className="mt-1 flex items-center gap-1.5 tabular-nums text-[var(--text-muted)]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: cpuColor }} />
            CPU {formatPct(hovered.cpuPct)}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 tabular-nums text-[var(--text-muted)]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: MEMORY_SERIES_COLOR }}
            />
            Memory {formatPct(hovered.memoryPct)}
          </p>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: cpuColor }} />
          CPU
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: MEMORY_SERIES_COLOR }}
          />
          Memory
        </span>
      </div>
    </div>
  );
}

export function SystemMonitorPanel() {
  const { data: monitor } = useSystemMonitor();
  const { data: health } = useHealth();
  const { data: info } = useInfo();
  const [samples, setSamples] = useState<MonitorSample[]>(() => [...sampleHistory]);

  useEffect(() => {
    if (monitor) setSamples(recordSample(monitor));
  }, [monitor]);

  const cpuSpark = useMemo(() => samples.map((sample) => sample.cpuPct), [samples]);
  const memorySpark = useMemo(() => samples.map((sample) => sample.memoryPct), [samples]);
  const processSpark = useMemo(() => samples.map((sample) => sample.processCpuPct), [samples]);

  const healthy = (health as { status?: string } | undefined)?.status === "healthy";
  const uptimeSeconds = Number((health as { uptime?: unknown } | undefined)?.uptime) || 0;
  const version = String((info as { version?: unknown } | undefined)?.version || "unknown");
  const sampleWindowMinutes = monitor
    ? Math.max(1, Math.round((samples.length * (monitor.sampleIntervalMs || 5000)) / 60000))
    : 5;

  return (
    <Card variant="liquid">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
              System Monitor
            </CardTitle>
            <CardDescription>
              Live host telemetry from the Cybara gateway — refreshed every{" "}
              {Math.round((monitor?.sampleIntervalMs || 5000) / 1000)}s
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={healthy ? "success" : "warning"}>
              <span className="relative mr-1.5 flex h-2 w-2">
                {healthy ? (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                ) : null}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${healthy ? "bg-emerald-400" : "bg-amber-400"}`}
                />
              </span>
              {healthy ? "Healthy" : "Degraded"}
            </Badge>
            <Badge variant="info">v{version}</Badge>
            {monitor ? (
              <Badge variant="default">
                {monitor.platform.type} {monitor.platform.arch} · {monitor.cpu.cores} cores
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={Cpu}
            label="CPU"
            value={formatPct(monitor?.cpu.usagePct)}
            detail={monitor?.cpu.model || "Loading CPU"}
            spark={cpuSpark}
            sparkColor="rgb(var(--accent-primary))"
          />
          <StatTile
            icon={MemoryStick}
            label="Memory"
            value={formatPct(monitor?.memory.usedPct)}
            detail={`${formatBytes(monitor?.memory.usedBytes)} of ${formatBytes(monitor?.memory.totalBytes)}`}
            spark={memorySpark}
            sparkColor={MEMORY_SERIES_COLOR}
          />
          <StatTile
            icon={Activity}
            label="Cybara process"
            value={formatPct(monitor?.process.cpuUsagePct)}
            detail={`${formatBytes(monitor?.process.memory.rssBytes)} RSS · PID ${monitor?.process.pid ?? "n/a"}`}
            spark={processSpark}
            sparkColor="rgb(var(--accent-primary))"
          />
          <StatTile
            icon={Timer}
            label="Uptime"
            value={formatUptime(uptimeSeconds)}
            detail={
              monitor?.cpu.loadAverage?.length
                ? `Load ${monitor.cpu.loadAverage.map((load) => load.toFixed(1)).join(" · ")}`
                : "Gateway uptime"
            }
          />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              Usage — last {sampleWindowMinutes} min
            </h4>
            <span className="text-xs tabular-nums text-[var(--text-muted)]">
              {samples.length} samples
            </span>
          </div>
          <UsageChart samples={samples} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Meter
            label="Memory pressure"
            ariaLabel="Memory pressure"
            pct={monitor?.memory.usedPct ?? 0}
            detail={`${formatBytes(monitor?.memory.freeBytes)} free`}
          />
          {monitor?.memory.swap ? (
            <Meter
              label="Swap"
              ariaLabel="Swap usage"
              pct={monitor.memory.swap.usedPct}
              detail={`${formatBytes(monitor.memory.swap.usedBytes)} of ${formatBytes(monitor.memory.swap.totalBytes)}`}
            />
          ) : (
            <Meter label="Swap" ariaLabel="Swap usage" pct={0} detail="No swap configured" />
          )}
          <Meter
            label={
              monitor?.disk ? (
                <span className="flex min-w-0 items-center gap-1" title={monitor.disk.path}>
                  <HardDrive className="h-3 w-3 shrink-0" />
                  <span className="truncate">Disk · {monitor.disk.path}</span>
                </span>
              ) : (
                "Disk"
              )
            }
            ariaLabel="Disk usage"
            pct={monitor?.disk?.usedPct ?? 0}
            detail={
              monitor?.disk
                ? `${formatStorageBytes(monitor.disk.freeBytes)} free of ${formatStorageBytes(monitor.disk.totalBytes)}`
                : "Disk telemetry unavailable"
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
