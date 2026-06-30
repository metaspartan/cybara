import { execFileSync } from "child_process";
import { readFileSync, statfsSync } from "fs";
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from "os";

export interface SystemByteUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPct: number;
}

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
  memory: SystemByteUsage & {
    swap: SystemByteUsage | null;
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
  disk:
    | (SystemByteUsage & {
        path: string;
      })
    | null;
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

function buildByteUsage(totalBytes: number, usedBytes: number): SystemByteUsage {
  const normalizedTotalBytes = Math.max(1, Math.round(totalBytes));
  const normalizedUsedBytes = Math.max(0, Math.min(normalizedTotalBytes, Math.round(usedBytes)));
  const freeBytes = Math.max(0, normalizedTotalBytes - normalizedUsedBytes);

  return {
    totalBytes: normalizedTotalBytes,
    freeBytes,
    usedBytes: normalizedUsedBytes,
    usedPct: roundPct((normalizedUsedBytes / normalizedTotalBytes) * 100),
  };
}

function buildMemoryUsage(
  totalBytes: number,
  usedBytes: number,
  swap: SystemByteUsage | null = null
): SystemMonitorSnapshot["memory"] {
  return {
    ...buildByteUsage(totalBytes, usedBytes),
    swap,
  };
}

function parseUnitBytes(value: string, unit: string): number | null {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;

  const normalizedUnit = unit.trim().toLowerCase();
  if (normalizedUnit === "b" || normalizedUnit === "bytes" || normalizedUnit === "") {
    return numericValue;
  }
  if (normalizedUnit === "k" || normalizedUnit === "kb") return numericValue * 1024;
  if (normalizedUnit === "m" || normalizedUnit === "mb") return numericValue * 1024 * 1024;
  if (normalizedUnit === "g" || normalizedUnit === "gb") return numericValue * 1024 * 1024 * 1024;
  if (normalizedUnit === "t" || normalizedUnit === "tb") {
    return numericValue * 1024 * 1024 * 1024 * 1024;
  }

  return null;
}

function parseVmStatPageValue(output: string, key: string): number | null {
  const pattern = new RegExp(`^${key}:\\s+([0-9]+)\\.?$`, "im");
  const match = output.match(pattern);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseDarwinVmStatMemory(
  output: string,
  totalBytes = totalmem()
): SystemMonitorSnapshot["memory"] | null {
  const pageSizeMatch = output.match(/page size of\s+([0-9]+)\s+bytes/i);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 0;
  const activePages = parseVmStatPageValue(output, "Pages active");
  const wiredPages = parseVmStatPageValue(output, "Pages wired down");
  const compressedPages = parseVmStatPageValue(output, "Pages occupied by compressor");

  if (
    !Number.isFinite(pageSize) ||
    pageSize <= 0 ||
    activePages === null ||
    wiredPages === null ||
    compressedPages === null
  ) {
    return null;
  }

  return buildMemoryUsage(totalBytes, (activePages + wiredPages + compressedPages) * pageSize);
}

export function parseDarwinSwapUsage(output: string): SystemByteUsage | null {
  const totalMatch = output.match(/total\s*=\s*([0-9.]+)\s*([kmgt]?)/i);
  const usedMatch = output.match(/used\s*=\s*([0-9.]+)\s*([kmgt]?)/i);
  if (!totalMatch || !usedMatch) return null;

  const totalBytes = parseUnitBytes(totalMatch[1], totalMatch[2]);
  const usedBytes = parseUnitBytes(usedMatch[1], usedMatch[2]);
  if (totalBytes === null || usedBytes === null || totalBytes <= 0) return null;

  return buildByteUsage(totalBytes, usedBytes);
}

export function parseLinuxMeminfoSwap(output: string): SystemByteUsage | null {
  const readKb = (key: string): number | null => {
    const match = output.match(new RegExp(`^${key}:\\s+([0-9]+)\\s+kB$`, "im"));
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value * 1024 : null;
  };

  const totalBytes = readKb("SwapTotal");
  const freeBytes = readKb("SwapFree");
  if (totalBytes === null || freeBytes === null || totalBytes <= 0) return null;

  return buildByteUsage(totalBytes, totalBytes - freeBytes);
}

function readSwapUsage(): SystemByteUsage | null {
  const osPlatform = platform();

  if (osPlatform === "darwin") {
    try {
      const output = execFileSync("/usr/sbin/sysctl", ["vm.swapusage"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 500,
      });
      return parseDarwinSwapUsage(output);
    } catch {
      return null;
    }
  }

  if (osPlatform === "linux") {
    try {
      return parseLinuxMeminfoSwap(readFileSync("/proc/meminfo", "utf8"));
    } catch {
      return null;
    }
  }

  return null;
}

function readGenericMemoryUsage(): SystemMonitorSnapshot["memory"] {
  const totalBytes = totalmem();
  return buildMemoryUsage(totalBytes, Math.max(0, totalBytes - freemem()), readSwapUsage());
}

function readMemoryUsage(): SystemMonitorSnapshot["memory"] {
  if (platform() !== "darwin") return readGenericMemoryUsage();

  try {
    const output = execFileSync("/usr/bin/vm_stat", [], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 750,
    });
    const memory = parseDarwinVmStatMemory(output);
    return memory ? { ...memory, swap: readSwapUsage() } : readGenericMemoryUsage();
  } catch {
    return readGenericMemoryUsage();
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
  const memory = readMemoryUsage();
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
    memory,
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
