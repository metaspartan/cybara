import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isCybaraProfileProcess } from "./cybara-process-match";

type MetricsSource = "ps" | "cim";

interface ProcessSample {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
  command: string;
}

interface RawProcessMetrics {
  pid: number;
  ppid: number;
  cpuPercent: number | null;
  rssBytes: number;
  command: string;
}

interface ProfileSample {
  sampledAt: string;
  metricsSource: MetricsSource;
  cpuPercentAvailable: boolean;
  totalCpuPercent: number;
  totalRssBytes: number;
  processes: ProcessSample[];
}

interface ProfileReport {
  startedAt: string;
  endedAt: string;
  metricsSource: MetricsSource;
  cpuPercentAvailable: boolean;
  durationSeconds: number;
  sampleCount: number;
  peakRssBytes: number;
  averageRssBytes: number;
  peakCpuPercent: number;
  averageCpuPercent: number;
  samples: ProfileSample[];
}

const DEFAULT_DURATION_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 2;

function numberArg(name: string, fallback: number): number {
  const index = Bun.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = Bun.argv[index + 1];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function flag(name: string): boolean {
  return Bun.argv.includes(name);
}

function outputPath(): string | null {
  const index = Bun.argv.indexOf("--out");
  if (index < 0) return null;
  return Bun.argv[index + 1] || null;
}

const WINDOWS_METRICS_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "$rows = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine",
  "$cpu = @{}",
  "Get-Process | ForEach-Object { $cpu[$_.Id] = $_.CPU }",
  "$out = foreach ($row in $rows) {",
  "  [pscustomobject]@{",
  "    pid = $row.ProcessId",
  "    ppid = $row.ParentProcessId",
  "    rss = $row.WorkingSetSize",
  "    cpuSeconds = $cpu[$row.ProcessId]",
  "    command = $row.CommandLine",
  "  }",
  "}",
  "$out | ConvertTo-Json -Compress -Depth 3",
].join("\n");

interface WindowsProcessRow {
  pid: number;
  ppid: number;
  rss: number;
  cpuSeconds: number | null;
  command: string | null;
}

const previousCpuSeconds = new Map<number, { seconds: number; at: number }>();

function parsePsLine(line: string): RawProcessMetrics | null {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  const cpuPercent = Number(match[3]);
  const rssBytes = Number(match[4]) * 1024;
  const command = match[5] || "";
  if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssBytes)) {
    return null;
  }
  return { pid, ppid, cpuPercent, rssBytes, command };
}

async function readPsMetrics(): Promise<RawProcessMetrics[]> {
  const result = await Bun.$`ps -axo pid=,ppid=,pcpu=,rss=,command=`.text();
  return result
    .split("\n")
    .map(parsePsLine)
    .filter((entry): entry is RawProcessMetrics => entry !== null);
}

async function readWindowsMetrics(): Promise<RawProcessMetrics[]> {
  const proc = Bun.spawn({
    cmd: ["powershell", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_METRICS_COMMAND],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`windows process metrics failed: ${stderr.trim()}`);
  }
  const parsed: unknown = stdout.trim() ? JSON.parse(stdout) : [];
  const rows: WindowsProcessRow[] = Array.isArray(parsed) ? parsed : [parsed];
  const sampledAt = Date.now();
  return rows
    .map((row) => {
      const previous = previousCpuSeconds.get(Number(row.pid));
      const cpuSeconds = typeof row.cpuSeconds === "number" ? row.cpuSeconds : null;
      let cpuPercent: number | null = null;
      if (cpuSeconds !== null && previous !== undefined) {
        const elapsedSeconds = (sampledAt - previous.at) / 1000;
        const deltaSeconds = cpuSeconds - previous.seconds;
        if (elapsedSeconds > 0 && deltaSeconds >= 0) {
          cpuPercent = (deltaSeconds / elapsedSeconds) * 100;
        }
      }
      if (cpuSeconds !== null)
        previousCpuSeconds.set(Number(row.pid), { seconds: cpuSeconds, at: sampledAt });
      return {
        pid: Number(row.pid),
        ppid: Number(row.ppid),
        cpuPercent,
        rssBytes: Number(row.rss) || 0,
        command: typeof row.command === "string" ? row.command : "",
      };
    })
    .filter(
      (entry) =>
        Number.isFinite(entry.pid) &&
        Number.isFinite(entry.ppid) &&
        Number.isFinite(entry.rssBytes) &&
        entry.command !== ""
    );
}

function metricsSource(): MetricsSource {
  return process.platform === "win32" ? "cim" : "ps";
}

async function sampleProcesses(): Promise<ProfileSample> {
  const source = metricsSource();
  const raw = source === "cim" ? await readWindowsMetrics() : await readPsMetrics();
  const processes: ProcessSample[] = raw
    .filter((entry) => isCybaraProfileProcess(entry.command, process.cwd()))
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .map((entry) => ({
      pid: entry.pid,
      ppid: entry.ppid,
      cpuPercent: entry.cpuPercent ?? 0,
      rssBytes: entry.rssBytes,
      command: entry.command,
    }));
  const cpuPercentAvailable = raw.some((entry) => entry.cpuPercent !== null);
  return {
    sampledAt: new Date().toISOString(),
    metricsSource: source,
    cpuPercentAvailable,
    totalCpuPercent: processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
    totalRssBytes: processes.reduce((sum, entry) => sum + entry.rssBytes, 0),
    processes,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const durationSeconds = numberArg("--duration", DEFAULT_DURATION_SECONDS);
  const intervalSeconds = Math.max(0.25, numberArg("--interval", DEFAULT_INTERVAL_SECONDS));
  const jsonOnly = flag("--json");
  const out = outputPath();
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationSeconds * 1000;
  const samples: ProfileSample[] = [];

  do {
    const sample = await sampleProcesses();
    samples.push(sample);
    if (!jsonOnly) {
      const cpu = sample.cpuPercentAvailable ? `${sample.totalCpuPercent.toFixed(1)}%` : "n/a";
      console.log(
        `${sample.sampledAt} rss=${formatBytes(sample.totalRssBytes)} cpu=${cpu} processes=${sample.processes.length} source=${sample.metricsSource}`
      );
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(intervalSeconds * 1000);
  } while (Date.now() < deadline);

  const endedAt = new Date().toISOString();
  const rssValues = samples.map((sample) => sample.totalRssBytes);
  const cpuAvailableSamples = samples.filter((sample) => sample.cpuPercentAvailable);
  const cpuValues = cpuAvailableSamples.map((sample) => sample.totalCpuPercent);
  const cpuPercentAvailable = cpuAvailableSamples.length > 0;
  const report: ProfileReport = {
    startedAt,
    endedAt,
    metricsSource: metricsSource(),
    cpuPercentAvailable,
    durationSeconds,
    sampleCount: samples.length,
    peakRssBytes: Math.max(0, ...rssValues),
    averageRssBytes: average(rssValues),
    peakCpuPercent: Math.max(0, ...cpuValues),
    averageCpuPercent: average(cpuValues),
    samples,
  };

  const json = JSON.stringify(report, null, 2);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
  }
  if (jsonOnly) {
    console.log(json);
  } else {
    const peakCpu = report.cpuPercentAvailable ? `${report.peakCpuPercent.toFixed(1)}%` : "n/a";
    const averageCpu = report.cpuPercentAvailable
      ? `${report.averageCpuPercent.toFixed(1)}%`
      : "n/a";
    console.log("");
    console.log(`Metrics source: ${report.metricsSource}`);
    console.log(`Peak RSS: ${formatBytes(report.peakRssBytes)}`);
    console.log(`Average RSS: ${formatBytes(report.averageRssBytes)}`);
    console.log(`Peak CPU: ${peakCpu}`);
    console.log(`Average CPU: ${averageCpu}`);
    if (out) console.log(`Report: ${out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
