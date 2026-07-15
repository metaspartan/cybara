import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isCybaraProfileProcess } from "./cybara-process-match";

interface ProcessSample {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
  command: string;
}

interface ProfileSample {
  sampledAt: string;
  totalCpuPercent: number;
  totalRssBytes: number;
  processes: ProcessSample[];
}

interface ProfileReport {
  startedAt: string;
  endedAt: string;
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

function parsePsLine(line: string): ProcessSample | null {
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
  if (!isCybaraProfileProcess(command, process.cwd())) return null;
  return { pid, ppid, cpuPercent, rssBytes, command };
}

async function sampleProcesses(): Promise<ProfileSample> {
  const result = await Bun.$`ps -axo pid=,ppid=,pcpu=,rss=,command=`.text();
  const processes = result
    .split("\n")
    .map(parsePsLine)
    .filter((process): process is ProcessSample => process !== null)
    .sort((a, b) => b.rssBytes - a.rssBytes);
  return {
    sampledAt: new Date().toISOString(),
    totalCpuPercent: processes.reduce((sum, process) => sum + process.cpuPercent, 0),
    totalRssBytes: processes.reduce((sum, process) => sum + process.rssBytes, 0),
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
      console.log(
        `${sample.sampledAt} rss=${formatBytes(sample.totalRssBytes)} cpu=${sample.totalCpuPercent.toFixed(1)}% processes=${sample.processes.length}`
      );
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(intervalSeconds * 1000);
  } while (Date.now() < deadline);

  const endedAt = new Date().toISOString();
  const rssValues = samples.map((sample) => sample.totalRssBytes);
  const cpuValues = samples.map((sample) => sample.totalCpuPercent);
  const report: ProfileReport = {
    startedAt,
    endedAt,
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
    console.log("");
    console.log(`Peak RSS: ${formatBytes(report.peakRssBytes)}`);
    console.log(`Average RSS: ${formatBytes(report.averageRssBytes)}`);
    console.log(`Peak CPU: ${report.peakCpuPercent.toFixed(1)}%`);
    console.log(`Average CPU: ${report.averageCpuPercent.toFixed(1)}%`);
    if (out) console.log(`Report: ${out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
