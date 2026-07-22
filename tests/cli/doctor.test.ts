import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDoctorReport,
  exportDoctorReport,
  type DoctorRuntime,
} from "../../src/cli/commands/doctor";

const directories: string[] = [];

function runtime(overrides: Partial<DoctorRuntime> = {}): DoctorRuntime {
  return {
    request: async (endpoint) => {
      if (endpoint === "/api/health") {
        return {
          status: "healthy",
          version: "1.2.3",
          uptime: 120,
          system: {
            status: "healthy",
            cpu: { usagePct: 12 },
            memory: { usedPct: 34 },
            disk: { path: "/Users/private/work", usedPct: 56 },
          },
          checks: { database: { status: "healthy", total: 1 } },
        };
      }
      if (endpoint === "/api/health/ready") return { ready: true };
      if (endpoint === "/api/info") {
        return {
          name: "Cybara",
          version: "1.2.3",
          setupComplete: true,
          homeDir: "/Users/private/.cybara",
          stats: { agents: { total: 2 } },
        };
      }
      if (endpoint === "/api/providers/health") {
        return { status: "healthy", summary: { total: 1, configured: 1 } };
      }
      if (endpoint === "/api/sessions?limit=1") {
        return [{ id: "private-session-id", content: "private chat" }];
      }
      if (endpoint === "/api/auth/settings") {
        return {
          apiKeyConfigured: true,
          apiKeyPreview: "secret-preview",
          apiKeySource: "file",
          gatewayPasswordEnabled: true,
          requireAuthForLocalhost: true,
          localhostBypassActive: false,
          remoteAccess: {
            enabled: true,
            provider: "tailscale",
            url: "https://private-host.example",
            status: { status: "ready" },
          },
        };
      }
      if (endpoint === "/api/lsp/status") {
        return {
          status: "ok",
          workspace: "/Users/private/work",
          supported: ["typescript"],
          active: [{ id: "typescript" }],
          diagnosticsCount: 2,
        };
      }
      if (endpoint === "/api/mcp") {
        return [{ id: "private-mcp", enabled: true, env: "TOKEN=secret" }];
      }
      if (endpoint === "/api/browser/status") {
        return { running: true, connected: true, executablePath: "/private/chrome" };
      }
      if (endpoint === "/api/nearby") {
        return {
          settings: { enabled: true },
          discovery: { udp: { running: true }, mdns: { running: true } },
          discoveredPeers: [{ id: "private-peer", name: "Private Computer" }],
          pairedPeers: [],
          pairings: [],
          incomingTransfers: [],
        };
      }
      if (endpoint === "/api/logs/system?limit=100") {
        return [
          {
            level: "error",
            source: "gateway",
            message: "api_key=secret-value at /Users/private/work",
          },
        ];
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    checkStatusWebSocket: async () => ({ ok: true, details: "received snapshot event" }),
    checkSandbox: () => ({ ok: true, details: "sandbox available" }),
    now: () => new Date("2026-07-22T12:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI doctor diagnostics", () => {
  test("runs deep non-mutating checks and exports only reduced snapshots", async () => {
    const report = await createDoctorReport(true, runtime());
    expect(report.summary).toEqual({ total: 13, passed: 13, warned: 0, failed: 0 });
    expect(report.snapshots["sessions-api"]).toEqual({ available: true });
    expect(report.snapshots.nearby).toEqual({
      enabled: true,
      discovery: { udpRunning: true, mdnsRunning: true },
      discoveredCount: 1,
      pairedCount: 0,
      pendingPairingCount: 0,
      incomingTransferCount: 0,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("private-session-id");
    expect(serialized).not.toContain("private chat");
    expect(serialized).not.toContain("secret-preview");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("/Users/private");
    expect(serialized).not.toContain("Private Computer");

    const directory = mkdtempSync(join(tmpdir(), "cybara-doctor-"));
    directories.push(directory);
    const outputPath = join(directory, "support", "report.json");
    expect(await exportDoctorReport(report, outputPath)).toBe(outputPath);
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(report);
  });

  test("fails required probes and warns for optional subsystem failures", async () => {
    const base = runtime();
    const report = await createDoctorReport(true, {
      ...base,
      request: async (endpoint) => {
        if (endpoint === "/api/health/ready") throw new Error("gateway not ready");
        if (endpoint === "/api/browser/status") throw new Error("browser unavailable");
        return await base.request(endpoint);
      },
      checkStatusWebSocket: async () => {
        throw new Error("websocket unavailable");
      },
      checkSandbox: () => {
        throw new Error("sandbox unavailable");
      },
    });

    expect(report.summary.failed).toBe(2);
    expect(report.summary.warned).toBe(2);
    expect(report.checks.find((check) => check.name === "readiness")?.severity).toBe("fail");
    expect(report.checks.find((check) => check.name === "status-ws")?.severity).toBe("fail");
    expect(report.checks.find((check) => check.name === "browser")?.severity).toBe("warn");
    expect(report.checks.find((check) => check.name === "sandbox-runtime")?.severity).toBe("warn");
  });
});
