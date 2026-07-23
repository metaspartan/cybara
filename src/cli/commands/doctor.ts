import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { getAppVersion } from "../../core/build-info";
import { logsDir } from "../../core/paths";
import { commandExists } from "../../core/platform";
import { requestCliAPI, resolveCliApiKey, CLI_API_BASE as API_BASE } from "../client";
import { classifyDoctorHealth, type DoctorSeverity } from "./status-contract";

export interface DoctorCheckResult {
  name: string;
  severity: DoctorSeverity;
  details: string;
  latencyMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  cybaraVersion: string;
  gateway: {
    protocol: string;
    port: string;
    hostKind: "loopback" | "private" | "hostname" | "unknown";
  };
  runtime: {
    platform: string;
    arch: string;
    bunVersion: string;
  };
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
  checks: DoctorCheckResult[];
  snapshots: Record<string, unknown>;
}

export interface DoctorRuntime {
  request(endpoint: string): Promise<unknown>;
  checkStatusWebSocket(): Promise<{ ok: boolean; details: string }>;
  checkSandbox(): { ok: boolean; details: string };
  now(): Date;
}

interface DoctorOptions {
  deep: boolean;
  json: boolean;
  exportPath?: string;
}

interface EndpointCheck {
  name: string;
  endpoint: string;
  required: boolean;
  evaluate(data: unknown): { severity: DoctorSeverity; details: string };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function gatewayTarget(baseUrl: string): DoctorReport["gateway"] {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const privateIpv4 =
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
    const privateIpv6 = /^(?:fc|fd|fe80)/.test(host);
    return {
      protocol: url.protocol.replace(":", ""),
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      hostKind: loopback ? "loopback" : privateIpv4 || privateIpv6 ? "private" : "hostname",
    };
  } catch {
    return { protocol: "unknown", port: "unknown", hostKind: "unknown" };
  }
}

function parseDoctorOptions(args: string[]): DoctorOptions {
  const exportIndex = args.indexOf("--export");
  const explicitPath = exportIndex >= 0 ? args[exportIndex + 1] : undefined;
  const exportPath = explicitPath && !explicitPath.startsWith("-") ? explicitPath : undefined;
  return {
    deep: args.includes("--deep") || exportIndex >= 0,
    json: args.includes("--json"),
    exportPath: exportIndex >= 0 ? exportPath || "" : undefined,
  };
}

function endpointChecks(deep: boolean): EndpointCheck[] {
  const checks: EndpointCheck[] = [
    {
      name: "health",
      endpoint: "/api/health",
      required: true,
      evaluate: (value) => {
        const data = record(value);
        const status = text(data.status);
        return {
          severity: classifyDoctorHealth(status),
          details: `status=${status || "unknown"} uptime=${Math.floor(numeric(data.uptime) || 0)}s`,
        };
      },
    },
    {
      name: "readiness",
      endpoint: "/api/health/ready",
      required: true,
      evaluate: (value) => {
        const ready = boolean(record(value).ready) === true;
        return {
          severity: ready ? "pass" : "fail",
          details: ready ? "gateway ready" : "not ready",
        };
      },
    },
    {
      name: "info",
      endpoint: "/api/info",
      required: true,
      evaluate: (value) => {
        const version = text(record(value).version);
        return {
          severity: version ? "pass" : "fail",
          details: `version=${version || "unknown"}`,
        };
      },
    },
    {
      name: "providers",
      endpoint: "/api/providers/health",
      required: false,
      evaluate: (value) => {
        const data = record(value);
        const status = text(data.status) || "unknown";
        const summary = record(data.summary);
        const configured = numeric(summary.configured) || 0;
        const total = numeric(summary.total) || 0;
        return {
          severity: status === "healthy" ? "pass" : "warn",
          details: `status=${status} configured=${configured}/${total}`,
        };
      },
    },
    {
      name: "sessions-api",
      endpoint: "/api/sessions?limit=1",
      required: true,
      evaluate: (value) => ({
        severity: Array.isArray(value) ? "pass" : "fail",
        details: Array.isArray(value) ? "session index available" : "invalid sessions response",
      }),
    },
  ];
  if (!deep) return checks;
  return [
    ...checks,
    {
      name: "auth",
      endpoint: "/api/auth/settings",
      required: false,
      evaluate: (value) => {
        const data = record(value);
        const bypass = boolean(data.localhostBypassActive) === true;
        return {
          severity: bypass ? "warn" : "pass",
          details: bypass ? "localhost auth bypass active" : "gateway auth policy active",
        };
      },
    },
    {
      name: "lsp",
      endpoint: "/api/lsp/status",
      required: false,
      evaluate: (value) => {
        const data = record(value);
        const status = text(data.status);
        const active = records(data.active).length;
        const supported = Array.isArray(data.supported) ? data.supported.length : 0;
        return {
          severity: status === "error" ? "warn" : "pass",
          details: `supported=${supported} active=${active}`,
        };
      },
    },
    {
      name: "mcp",
      endpoint: "/api/mcp",
      required: false,
      evaluate: (value) => ({
        severity: Array.isArray(value) ? "pass" : "warn",
        details: `servers=${Array.isArray(value) ? value.length : 0}`,
      }),
    },
    {
      name: "browser",
      endpoint: "/api/browser/status",
      required: false,
      evaluate: (value) => {
        const data = record(value);
        const error = text(data.error);
        return {
          severity: error ? "warn" : "pass",
          details: error || `running=${boolean(data.running) === true ? "yes" : "no"}`,
        };
      },
    },
    {
      name: "nearby",
      endpoint: "/api/nearby",
      required: false,
      evaluate: (value) => {
        const data = record(value);
        const settings = record(data.settings);
        const enabled = boolean(settings.enabled) === true;
        const discovery = record(data.discovery);
        const udp = record(discovery.udp);
        const mdns = record(discovery.mdns);
        const available = boolean(udp.running) === true || boolean(mdns.running) === true;
        return {
          severity: enabled && !available ? "warn" : "pass",
          details: enabled
            ? `enabled discovery=${available ? "available" : "unavailable"}`
            : "disabled",
        };
      },
    },
    {
      name: "logs",
      endpoint: "/api/logs/system?limit=100",
      required: false,
      evaluate: (value) => ({
        severity: Array.isArray(value) ? "pass" : "warn",
        details: `recent=${Array.isArray(value) ? value.length : 0}`,
      }),
    },
  ];
}

function summarizeSnapshot(name: string, value: unknown): unknown {
  const data = record(value);
  if (name === "health") {
    const system = record(data.system);
    const cpu = record(system.cpu);
    const memory = record(system.memory);
    const disk = record(system.disk);
    return {
      status: text(data.status),
      version: text(data.version),
      uptimeSeconds: numeric(data.uptime),
      system: {
        status: text(system.status),
        cpuUsagePct: numeric(cpu.usagePct),
        memoryUsedPct: numeric(memory.usedPct),
        diskUsedPct: numeric(disk.usedPct),
      },
      checks: Object.fromEntries(
        Object.entries(record(data.checks)).map(([key, raw]) => {
          const check = record(raw);
          return [key, { status: text(check.status), total: numeric(check.total) }];
        })
      ),
    };
  }
  if (name === "info") {
    return {
      name: text(data.name),
      version: text(data.version),
      setupComplete: boolean(data.setupComplete),
      stats: data.stats,
    };
  }
  if (name === "providers") return { status: data.status, summary: data.summary };
  if (name === "auth") {
    const remote = record(data.remoteAccess);
    return {
      apiKeyConfigured: boolean(data.apiKeyConfigured),
      apiKeySource: text(data.apiKeySource),
      gatewayPasswordEnabled: boolean(data.gatewayPasswordEnabled),
      requireAuthForLocalhost: boolean(data.requireAuthForLocalhost),
      localhostBypassActive: boolean(data.localhostBypassActive),
      remoteAccess: {
        enabled: boolean(remote.enabled),
        provider: text(remote.provider),
        status: text(record(remote.status).status),
      },
    };
  }
  if (name === "lsp") {
    return {
      status: text(data.status),
      supported: Array.isArray(data.supported) ? data.supported : [],
      activeCount: records(data.active).length,
      diagnosticsCount: numeric(data.diagnosticsCount),
    };
  }
  if (name === "mcp") {
    const servers = records(value);
    return {
      total: servers.length,
      enabled: servers.filter((server) => server.enabled !== false).length,
    };
  }
  if (name === "browser") {
    return {
      running: boolean(data.running),
      connected: boolean(data.connected),
      provider: text(data.provider),
      errorPresent: Boolean(text(data.error)),
    };
  }
  if (name === "nearby") {
    const settings = record(data.settings);
    const discovery = record(data.discovery);
    return {
      enabled: boolean(settings.enabled),
      discovery: {
        udpRunning: boolean(record(discovery.udp).running),
        mdnsRunning: boolean(record(discovery.mdns).running),
      },
      discoveredCount: records(data.discoveredPeers).length,
      pairedCount: records(data.pairedPeers).length,
      pendingPairingCount: records(data.pairings).length,
      incomingTransferCount: records(data.incomingTransfers).length,
    };
  }
  if (name === "logs") {
    const entries = records(value);
    const byLevel: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const entry of entries) {
      const level = text(entry.level) || "unknown";
      const source = text(entry.source) || text(entry.logType) || "unknown";
      byLevel[level] = (byLevel[level] || 0) + 1;
      bySource[source] = (bySource[source] || 0) + 1;
    }
    return { count: entries.length, byLevel, bySource };
  }
  if (name === "sessions-api") return { available: Array.isArray(value) };
  if (name === "readiness") return { ready: boolean(data.ready) };
  return {};
}

async function runEndpointCheck(
  check: EndpointCheck,
  runtime: DoctorRuntime,
  snapshots: Record<string, unknown>
): Promise<DoctorCheckResult> {
  const startedAt = Date.now();
  try {
    const data = await runtime.request(check.endpoint);
    snapshots[check.name] = summarizeSnapshot(check.name, data);
    const result = check.evaluate(data);
    return { name: check.name, ...result, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name: check.name,
      severity: check.required ? "fail" : "warn",
      details: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkStatusWebSocket(): Promise<{ ok: boolean; details: string }> {
  const apiKey = resolveCliApiKey();
  const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : "";
  const wsUrl = `${API_BASE.replace(/^http/i, "ws")}/api/ws/status${tokenParam}`;
  return await new Promise((resolveResult) => {
    let settled = false;
    const socket = new WebSocket(wsUrl);
    const finish = (ok: boolean, details: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        void 0;
      }
      resolveResult({ ok, details });
    };
    const timeout = setTimeout(() => finish(false, "timeout waiting for snapshot event"), 5000);
    socket.onmessage = (event) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        void 0;
      }
      const isSnapshot = text(record(payload).type) === "snapshot";
      finish(
        isSnapshot,
        isSnapshot ? "received snapshot event" : "did not receive snapshot payload"
      );
    };
    socket.onerror = () => finish(false, "websocket connection failed");
    socket.onclose = () => finish(false, "websocket closed before snapshot");
  });
}

function checkSandboxRuntime(): { ok: boolean; details: string } {
  if (process.platform === "darwin" && process.arch === "arm64") {
    if (commandExists("sandbox-exec")) {
      return { ok: true, details: "apple sandbox available" };
    }
    if (commandExists("docker")) return { ok: true, details: "docker sandbox available" };
    return { ok: false, details: "sandbox-exec and docker unavailable" };
  }
  if (process.platform === "linux") {
    if (commandExists("podman")) return { ok: true, details: "podman sandbox available" };
    if (commandExists("docker")) return { ok: true, details: "docker sandbox available" };
    return { ok: false, details: "podman and docker unavailable" };
  }
  if (commandExists("docker")) return { ok: true, details: "docker sandbox available" };
  return { ok: false, details: `docker unavailable on ${process.platform}` };
}

function defaultRuntime(): DoctorRuntime {
  return {
    request: async (endpoint) => await requestCliAPI<unknown>(endpoint),
    checkStatusWebSocket,
    checkSandbox: checkSandboxRuntime,
    now: () => new Date(),
  };
}

export async function createDoctorReport(
  deep: boolean,
  runtime: DoctorRuntime = defaultRuntime()
): Promise<DoctorReport> {
  const snapshots: Record<string, unknown> = {};
  const checks = await Promise.all(
    endpointChecks(deep).map((check) => runEndpointCheck(check, runtime, snapshots))
  );
  const wsStartedAt = Date.now();
  let websocket: { ok: boolean; details: string };
  try {
    websocket = await runtime.checkStatusWebSocket();
  } catch (error) {
    websocket = {
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push({
    name: "status-ws",
    severity: websocket.ok ? "pass" : "fail",
    details: websocket.details,
    latencyMs: Date.now() - wsStartedAt,
  });
  const sandboxStartedAt = Date.now();
  let sandbox: { ok: boolean; details: string };
  try {
    sandbox = runtime.checkSandbox();
  } catch (error) {
    sandbox = {
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push({
    name: "sandbox-runtime",
    severity: sandbox.ok ? "pass" : "warn",
    details: sandbox.details,
    latencyMs: Date.now() - sandboxStartedAt,
  });
  const passed = checks.filter((check) => check.severity === "pass").length;
  const warned = checks.filter((check) => check.severity === "warn").length;
  const failed = checks.filter((check) => check.severity === "fail").length;
  return {
    schemaVersion: 1,
    generatedAt: runtime.now().toISOString(),
    cybaraVersion: getAppVersion(),
    gateway: gatewayTarget(API_BASE),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
    },
    summary: { total: checks.length, passed, warned, failed },
    checks,
    snapshots,
  };
}

function defaultExportPath(report: DoctorReport): string {
  const timestamp = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  return resolve(logsDir, "diagnostics", `cybara-diagnostics-${timestamp}.json`);
}

export async function exportDoctorReport(
  report: DoctorReport,
  outputPath?: string
): Promise<string> {
  const target = outputPath?.trim() ? resolve(outputPath) : defaultExportPath(report);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

function printDoctorReport(report: DoctorReport): void {
  console.log("CYBARA DOCTOR");
  console.log("=============");
  for (const check of report.checks) {
    console.log(
      `  [${check.severity.toUpperCase()}] ${check.name} (${check.latencyMs}ms) - ${check.details}`
    );
  }
  console.log("");
  console.log(
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.warned} warned, ${report.summary.failed} failed`
  );
}

export async function rawDoctor(args: string[] = []): Promise<void> {
  const options = parseDoctorOptions(args);
  const report = await createDoctorReport(options.deep);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printDoctorReport(report);
  if (options.exportPath !== undefined) {
    const path = await exportDoctorReport(report, options.exportPath);
    if (!options.json) console.log(`Diagnostics exported: ${path}`);
  }
  if (report.summary.failed > 0) process.exitCode = 1;
}
