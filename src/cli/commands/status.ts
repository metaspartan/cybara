import { CLI_API_BASE as API_BASE, fetchCliAPI as fetchAPI } from "../client";
import {
  formatStatusBytes,
  formatStatusPct,
  formatStatusStorageBytes,
  formatStatusUptime,
  type StatusResponse,
} from "./status-contract";

export async function rawStatus(): Promise<void> {
  const data = await fetchAPI<StatusResponse>("/api/health");
  if (!data) {
    console.error("ERROR: Failed to connect to Cybara server at", API_BASE);
    process.exit(1);
  }

  console.log("CYBARA STATUS");
  console.log("=============");
  console.log(`status: ${data.status}`);
  console.log(`uptime: ${formatStatusUptime(data.uptime)}`);
  console.log(`timestamp: ${data.timestamp}`);
  if (data.system) {
    console.log("");
    console.log("SYSTEM MONITOR");
    console.log(
      `  cpu: ${formatStatusPct(data.system.cpu?.usagePct)} (${data.system.cpu?.cores || 0} cores)`
    );
    console.log(
      `  memory: ${formatStatusPct(data.system.memory?.usedPct)} used (${formatStatusBytes(data.system.memory?.usedBytes)} / ${formatStatusBytes(data.system.memory?.totalBytes)})`
    );
    if (data.system.memory?.swap) {
      console.log(
        `  swap: ${formatStatusPct(data.system.memory.swap.usedPct)} used (${formatStatusBytes(data.system.memory.swap.usedBytes)} / ${formatStatusBytes(data.system.memory.swap.totalBytes)})`
      );
    }
    if (data.system.process) {
      console.log(
        `  process: ${formatStatusPct(data.system.process.cpuUsagePct)} CPU, ${formatStatusBytes(data.system.process.memory?.rssBytes)} RSS`
      );
    }
    if (data.system.disk) {
      console.log(
        `  disk: ${formatStatusPct(data.system.disk.usedPct)} used (${formatStatusStorageBytes(data.system.disk.freeBytes)} free)`
      );
    }
  }
  console.log("");
  console.log("HEALTH CHECKS");
  for (const [name, info] of Object.entries(data.checks || {})) {
    const status = info.status || "ok";
    const extra = info.total !== undefined ? ` (${info.total} total)` : "";
    console.log(`  ${name}: ${status}${extra}`);
  }
}
