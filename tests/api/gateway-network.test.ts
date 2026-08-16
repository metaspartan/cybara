import { afterEach, describe, expect, test } from "bun:test";
import {
  buildWindowsGatewayFirewallCommand,
  ensureWindowsGatewayFirewallRule,
  normalizeGatewayBindHost,
  readRuntimeGatewayPort,
  requestGatewayHostApply,
  setGatewayHostApplyHandler,
  updateGatewayHostSetting,
} from "../../src/api/gateway-network";
import { config } from "../../src/core/config";

const originalCybaraHost = process.env.CYBARA_HOST;
const originalRuntimePort = process.env.CYBARA_RUNTIME_PORT;
const originalPort = process.env.PORT;

describe("gateway network settings", () => {
  afterEach(() => {
    setGatewayHostApplyHandler(null);
    config.set("host", "127.0.0.1");
    if (originalCybaraHost === undefined) delete process.env.CYBARA_HOST;
    else process.env.CYBARA_HOST = originalCybaraHost;
    if (originalRuntimePort === undefined) delete process.env.CYBARA_RUNTIME_PORT;
    else process.env.CYBARA_RUNTIME_PORT = originalRuntimePort;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  test("normalizes safe bind hosts and rejects URLs", () => {
    expect(normalizeGatewayBindHost(" 0.0.0.0 ")).toBe("0.0.0.0");
    expect(normalizeGatewayBindHost("LOCALHOST")).toBe("localhost");
    expect(normalizeGatewayBindHost("192.168.50.116")).toBe("192.168.50.116");
    expect(normalizeGatewayBindHost("gateway.local")).toBe("gateway.local");
    expect(() => normalizeGatewayBindHost("http://192.168.50.116:4269")).toThrow("not a URL");
  });

  test("schedules host apply through the registered runtime handler", () => {
    const requested: string[] = [];
    setGatewayHostApplyHandler((host) => {
      requested.push(host);
    });

    expect(requestGatewayHostApply("0.0.0.0")).toEqual({ scheduled: true });
    expect(requested).toEqual(["0.0.0.0"]);
  });

  test("reports unavailable runtime apply handler", () => {
    expect(requestGatewayHostApply("0.0.0.0")).toMatchObject({ scheduled: false });
  });

  test("allows Settings to rebind the running gateway even when launched with CYBARA_HOST", () => {
    const requested: string[] = [];
    process.env.CYBARA_HOST = "127.0.0.1";
    setGatewayHostApplyHandler((host) => {
      requested.push(host);
    });

    expect(updateGatewayHostSetting("0.0.0.0", true)).toMatchObject({
      hostApplyScheduled: true,
      gatewayFirewall: { required: false, configured: true, state: "not_required" },
    });
    expect(config.get("host")).toBe("0.0.0.0");
    expect(requested).toEqual(["0.0.0.0"]);
  });

  test("builds a Windows firewall command that works across firewall profiles", () => {
    expect(buildWindowsGatewayFirewallCommand(4269)).toContain("-Profile Any");
  });

  test("uses the live fallback port for gateway settings and firewall rules", () => {
    process.env.CYBARA_RUNTIME_PORT = "4271";
    process.env.PORT = "4269";

    expect(readRuntimeGatewayPort()).toBe(4271);

    const calls: string[][] = [];
    const result = ensureWindowsGatewayFirewallRule({
      host: "0.0.0.0",
      port: readRuntimeGatewayPort(),
      platform: "win32",
      runner: (cmd) => {
        calls.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.ruleName).toBe("Cybara Gateway 4271");
    expect(result.command).toContain("-LocalPort 4271");
    expect(calls).toHaveLength(1);
  });

  test("does not touch Windows firewall when the host is local-only", () => {
    const calls: string[][] = [];
    const result = ensureWindowsGatewayFirewallRule({
      host: "127.0.0.1",
      port: 4269,
      platform: "win32",
      runner: (cmd) => {
        calls.push(cmd);
        return { exitCode: 1, stdout: "", stderr: "should not run" };
      },
    });

    expect(result.required).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.state).toBe("not_required");
    expect(calls).toEqual([]);
  });

  test("reports an existing Windows firewall rule as configured", () => {
    const calls: string[][] = [];
    const result = ensureWindowsGatewayFirewallRule({
      host: "0.0.0.0",
      port: 4269,
      platform: "win32",
      runner: (cmd) => {
        calls.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.required).toBe(true);
    expect(result.attempted).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.state).toBe("configured");
    expect(calls).toHaveLength(1);
  });

  test("uses elevated PowerShell when Windows firewall needs administrator approval", () => {
    const results = [
      { exitCode: 2, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "Access is denied." },
      { exitCode: 2, stdout: "", stderr: "Access is denied." },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    ];
    const calls: string[][] = [];
    const result = ensureWindowsGatewayFirewallRule({
      host: "0.0.0.0",
      port: 4269,
      platform: "win32",
      runner: (cmd) => {
        calls.push(cmd);
        return results.shift() || { exitCode: 1, stdout: "", stderr: "unexpected call" };
      },
    });

    expect(result.configured).toBe(true);
    expect(result.attempted).toBe(true);
    expect(result.state).toBe("configured");
    expect(calls).toHaveLength(5);
  });

  test("surfaces administrator approval when elevated firewall update is declined", () => {
    const results = [
      { exitCode: 2, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "Access is denied." },
      { exitCode: 2, stdout: "", stderr: "Access is denied." },
      { exitCode: 1, stdout: "", stderr: "The operation was canceled by the user." },
      { exitCode: 2, stdout: "", stderr: "" },
    ];
    const result = ensureWindowsGatewayFirewallRule({
      host: "0.0.0.0",
      port: 4269,
      platform: "win32",
      runner: () => results.shift() || { exitCode: 1, stdout: "", stderr: "unexpected call" },
    });

    expect(result.configured).toBe(false);
    expect(result.attempted).toBe(true);
    expect(result.state).toBe("requires_admin");
    expect(result.message).toContain("administrator approval");
    expect(result.command).toContain("-Profile Any");
  });
});
