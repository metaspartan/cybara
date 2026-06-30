import { statfsSync } from "fs";
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from "os";

export interface SystemMonitorSnapshot {
  status: "healthy";
  timestamp: string;
  sampleIntervalMs: number;
  platform: {
    type: NodeJS.Platform;
    arch: string;
    release: string;
  };
  cpu: {
    usagePct: number;
    loadPct: number | null;
    loadAverage: number[];
    cores: number;
    model: string;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPct: number;
  };
  process: {
    pid: number;
    uptimeSeconds: number;
    cpuUsagePct: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
      arrayBuffersBytes: number;
    };
  };
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPct: number;
  } | null;
}

interface CpuTotals {
  idle: number;
  total: number;
}

interface MonitorSample {
  cpuTotals: CpuTotals;
  processCpuUsage: NodeJS.CpuUsage;
  sampledAtMs: number;
}

const SYSTEM_MONITOR_CACHE_MS = 1000;
let lastSample: MonitorSample | null = null;
let cachedSnapshot: SystemMonitorSnapshot | null = null;
let cachedUntilMs = 0;

function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function readCpuTotals(): CpuTotals {
  const cpuRows = cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpuRows) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

function cpuUsagePct(current: CpuTotals, previous: CpuTotals | null): number {
  if (!previous) return 0;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  const idleDelta = current.idle - previous.idle;
  return roundPct(((totalDelta - idleDelta) / totalDelta) * 100);
}

function processCpuUsagePct(
  current: NodeJS.CpuUsage,
  previous: NodeJS.CpuUsage | null,
  intervalMs: number,
  coreCount: number
): number {
  if (!previous || intervalMs <= 0 || coreCount <= 0) return 0;
  const usedMicros =
    Math.max(0, current.user - previous.user) + Math.max(0, current.system - previous.system);
  const availableMicros = intervalMs * 1000 * coreCount;
  if (availableMicros <= 0) return 0;
  return roundPct((usedMicros / availableMicros) * 100);
}

function readDiskUsage(path: string): SystemMonitorSnapshot["disk"] {
  try {
    const stats = statfsSync(path);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bavail) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
      return null;
    }
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      path,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPct: roundPct((usedBytes / totalBytes) * 100),
    };
  } catch {
    return null;
  }
}

export function getSystemMonitorSnapshot(): SystemMonitorSnapshot {
  const nowMs = Date.now();
  if (cachedSnapshot && cachedUntilMs > nowMs) return cachedSnapshot;

  const cpuRows = cpus();
  const coreCount = Math.max(1, cpuRows.length);
  const cpuTotals = readCpuTotals();
  const currentProcessCpu = process.cpuUsage();
  const intervalMs = lastSample ? Math.max(0, nowMs - lastSample.sampledAtMs) : 0;
  const totalMemoryBytes = totalmem();
  const freeMemoryBytes = freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const processMemory = process.memoryUsage();
  const loads = loadavg();
  const oneMinuteLoad = loads[0] || 0;

  const snapshot: SystemMonitorSnapshot = {
    status: "healthy",
    timestamp: new Date(nowMs).toISOString(),
    sampleIntervalMs: intervalMs,
    platform: {
      type: platform(),
      arch: arch(),
      release: release(),
    },
    cpu: {
      usagePct: cpuUsagePct(cpuTotals, lastSample?.cpuTotals ?? null),
      loadPct: platform() === "win32" ? null : roundPct((oneMinuteLoad / coreCount) * 100),
      loadAverage: loads.map((load) => Number(load.toFixed(2))),
      cores: coreCount,
      model: cpuRows[0]?.model || "Unknown CPU",
    },
    memory: {
      totalBytes: totalMemoryBytes,
      freeBytes: freeMemoryBytes,
      usedBytes: usedMemoryBytes,
      usedPct: roundPct((usedMemoryBytes / Math.max(1, totalMemoryBytes)) * 100),
    },
    process: {
      pid: process.pid,
      uptimeSeconds: process.uptime(),
      cpuUsagePct: processCpuUsagePct(
        currentProcessCpu,
        lastSample?.processCpuUsage ?? null,
        intervalMs,
        coreCount
      ),
      memory: {
        rssBytes: processMemory.rss,
        heapUsedBytes: processMemory.heapUsed,
        heapTotalBytes: processMemory.heapTotal,
        externalBytes: processMemory.external,
        arrayBuffersBytes: processMemory.arrayBuffers,
      },
    },
    disk: readDiskUsage(process.cwd()),
  };

  lastSample = {
    cpuTotals,
    processCpuUsage: currentProcessCpu,
    sampledAtMs: nowMs,
  };
  cachedSnapshot = snapshot;
  cachedUntilMs = nowMs + SYSTEM_MONITOR_CACHE_MS;
  return snapshot;
}
