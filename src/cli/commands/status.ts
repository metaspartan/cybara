import { commandExists } from "../../core/platform";
import { CLI_API_BASE as API_BASE, fetchCliAPI as fetchAPI, resolveCliApiKey } from "../client";
import {
  classifyDoctorHealth,
  type DoctorSeverity,
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

interface DoctorCheckResult {
  name: string;
  severity: DoctorSeverity;
  details: string;
  latencyMs?: number;
}

function formatDoctorLatency(latencyMs?: number): string {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) return "";
  return ` (${latencyMs}ms)`;
}

async function runDoctorCheck(
  name: string,
  check: () => Promise<{ severity: DoctorSeverity; details: string }>
): Promise<DoctorCheckResult> {
  const startedAt = Date.now();
  try {
    const result = await check();
    return {
      name,
      severity: result.severity,
      details: result.details,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      severity: "fail",
      details: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkStatusWebSocket(): Promise<{
  ok: boolean;
  details: string;
}> {
  const apiKey = resolveCliApiKey();
  const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : "";
  const wsUrl = `${API_BASE.replace(/^http/i, "ws")}/api/ws/status${tokenParam}`;
  return await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        void 0;
      }
      resolve({ ok: false, details: "timeout waiting for snapshot event" });
    }, 5000);

    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        void 0;
      }
      try {
        socket.close();
      } catch {
        void 0;
      }
      const isSnapshot = Boolean(
        payload &&
          typeof payload === "object" &&
          "type" in payload &&
          (payload as { type?: string }).type === "snapshot"
      );
      resolve({
        ok: isSnapshot,
        details: isSnapshot ? "received snapshot event" : "did not receive snapshot payload",
      });
    };

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, details: "websocket connection failed" });
    };

    socket.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, details: "websocket closed before snapshot" });
    };
  });
}

function checkSandboxRuntime(): { ok: boolean; details: string } {
  if (process.platform === "darwin" && process.arch === "arm64") {
    const hasAppleSandbox = commandExists("sandbox-exec");
    const hasDocker = commandExists("docker");
    if (hasAppleSandbox || hasDocker) {
      return {
        ok: true,
        details: hasAppleSandbox
          ? "sandbox-exec detected (apple sandbox available)"
          : "docker detected (container sandbox fallback available)",
      };
    }
    return {
      ok: false,
      details: "sandbox-exec and docker missing (install Xcode command line tools or Docker)",
    };
  }

  if (process.platform === "linux") {
    const hasPodman = commandExists("podman");
    const hasDocker = commandExists("docker");
    if (hasPodman || hasDocker) {
      return {
        ok: true,
        details: hasPodman
          ? "podman detected (container sandbox available)"
          : "docker detected (container sandbox fallback available)",
      };
    }
    return {
      ok: false,
      details: "podman and docker missing (install podman or docker for sandbox mode)",
    };
  }

  if (commandExists("docker")) {
    return {
      ok: true,
      details: "docker detected (container sandbox available)",
    };
  }
  return {
    ok: false,
    details: `no sandbox provider detected on ${process.platform}; install docker`,
  };
}

export async function rawDoctor(): Promise<void> {
  const checks: DoctorCheckResult[] = [];

  checks.push(
    await runDoctorCheck("health", async () => {
      const data = await fetchAPI<StatusResponse>("/api/health");
      if (!data) return { severity: "fail", details: "no response from /api/health" };
      return {
        severity: classifyDoctorHealth(data.status),
        details: `status=${data.status} uptime=${Math.floor(data.uptime)}s`,
      };
    })
  );

  checks.push(
    await runDoctorCheck("info", async () => {
      const data = await fetchAPI<{
        version?: string;
        stats?: Record<string, unknown>;
      }>("/api/info");
      if (!data) return { severity: "fail", details: "no response from /api/info" };
      return { severity: "pass", details: `version=${data.version || "unknown"}` };
    })
  );

  checks.push(
    await runDoctorCheck("sessions-api", async () => {
      const sessions = await fetchAPI<Array<{ id: string }>>("/api/sessions");
      if (!sessions) return { severity: "fail", details: "failed to fetch /api/sessions" };
      return { severity: "pass", details: `${sessions.length} sessions loaded` };
    })
  );

  checks.push(
    await runDoctorCheck("status-ws", async () => {
      const result = await checkStatusWebSocket();
      return { severity: result.ok ? "pass" : "fail", details: result.details };
    })
  );

  checks.push(
    await runDoctorCheck("sandbox-runtime", async () => {
      const result = checkSandboxRuntime();
      return { severity: result.ok ? "pass" : "fail", details: result.details };
    })
  );

  const passed = checks.filter((check) => check.severity === "pass").length;
  const warned = checks.filter((check) => check.severity === "warn").length;
  const failed = checks.filter((check) => check.severity === "fail").length;

  console.log("CYBARA DOCTOR");
  console.log("=============");
  for (const check of checks) {
    const marker = check.severity.toUpperCase();
    console.log(
      `  [${marker}] ${check.name}${formatDoctorLatency(check.latencyMs)} - ${check.details}`
    );
  }
  console.log("");
  console.log(`Summary: ${passed}/${checks.length} passed, ${warned} warned, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}
