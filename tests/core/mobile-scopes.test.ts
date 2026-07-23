import { afterEach, describe, expect, test } from "bun:test";
import { routeRequiredScope, securityCheck } from "../../src/api/security";
import {
  authenticateMobileDeviceToken,
  buildMobileConnectInfo,
  createMobileDevice,
  createPairingCode,
  DEFAULT_MOBILE_SCOPES,
  getMobileDeviceStorePath,
  isLoopbackMobileGatewayUrl,
  listMobileDevices,
  listMobilePushTargets,
  normalizeMobilePushToken,
  normalizeMobileScopes,
  recordMobilePushSendResult,
  redeemPairingCode,
  resetMobileDeviceStoreForTests,
  scopesForRole,
  updateMobileDevicePushToken,
  validateMobilePairingBaseUrl,
} from "../../src/core/mobile-devices";
import { secureDir } from "../../src/core/paths";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  resetMobileDeviceStoreForTests();
});

describe("mobile device scopes", () => {
  test("test runs isolate the mobile device store from the real gateway pairing file", () => {
    const storePath = getMobileDeviceStorePath();
    expect(storePath).toContain("cybara-mobile-device-test-stores");
    expect(storePath.startsWith(secureDir)).toBe(false);
  });

  test("new pairings default to limited scopes (no wallet/terminal)", () => {
    const { token } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });
    const view = authenticateMobileDeviceToken(token);
    expect(view?.scopes.sort()).toEqual([...DEFAULT_MOBILE_SCOPES].sort());
    expect(view?.scopes).not.toContain("wallet");
    expect(view?.scopes).not.toContain("terminal");
    expect(view?.scopes).not.toContain("mcp");
    expect(view?.scopes).not.toContain("nearby");
  });

  test("an admin can grant extra scopes at pairing time", () => {
    const { token } = createMobileDevice({
      baseUrl: "http://127.0.0.1:4269",
      scopes: ["chat", "wallet"],
    });
    const view = authenticateMobileDeviceToken(token);
    expect(view?.scopes.sort()).toEqual(["chat", "wallet"]);
  });

  test("normalizeMobileScopes drops junk and falls back to defaults", () => {
    expect(normalizeMobileScopes(["chat", "bogus", "wallet"])).toEqual(["chat", "wallet"]);
    expect(normalizeMobileScopes("nope")).toEqual([...DEFAULT_MOBILE_SCOPES]);
    expect(normalizeMobileScopes([])).toEqual([...DEFAULT_MOBILE_SCOPES]);
  });

  test("stores push tokens server-side and only exposes a status summary", () => {
    const expoToken = "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]";
    const { device } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });

    const updated = updateMobileDevicePushToken(device.id, {
      token: expoToken,
      provider: "expo",
      platform: "ios",
    });

    expect(updated?.push).toMatchObject({
      configured: true,
      enabled: true,
      provider: "expo",
      platform: "ios",
    });
    expect(JSON.stringify(updated)).not.toContain(expoToken);
    expect(listMobilePushTargets()).toEqual([
      {
        id: device.id,
        name: "Mobile Device",
        token: expoToken,
        provider: "expo",
        platform: "ios",
      },
    ]);

    recordMobilePushSendResult(device.id, { success: true });
    expect(listMobileDevices()[0]?.push.lastSentAt).toBeDefined();

    const cleared = updateMobileDevicePushToken(device.id, { enabled: false });
    expect(cleared?.push.configured).toBe(false);
    expect(listMobilePushTargets()).toEqual([]);
  });

  test("rejects unsupported mobile push token formats", () => {
    expect(normalizeMobilePushToken("ExponentPushToken[abcdefghijklmnopqrstuvwxyz]")).toContain(
      "ExponentPushToken"
    );
    expect(() =>
      normalizeMobilePushToken("unsupported_push_token_abcdefghijklmnopqrstuvwxyz")
    ).toThrow("unsupported push token");
    expect(() =>
      updateMobileDevicePushToken("missing", {
        token: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]",
      })
    ).not.toThrow();
  });
});

describe("route scope requirements", () => {
  test("gateway auth management requires a scope no device can hold", () => {
    expect(routeRequiredScope("GET", "/api/auth/settings")).toBe("root");
    expect(routeRequiredScope("PUT", "/api/auth/settings")).toBe("root");
    expect(routeRequiredScope("GET", "/api/auth/key")).toBe("root");
    expect(routeRequiredScope("POST", "/api/auth/rotate-key")).toBe("root");
    expect(routeRequiredScope("GET", "/api/system/backups")).toBe("root");
    expect(routeRequiredScope("POST", "/api/system/backups")).toBe("root");
    expect(routeRequiredScope("POST", "/api/system/backups/backup_12345678/restore")).toBe("root");
    expect(routeRequiredScope("GET", "/api/nearby")).toBe("nearby");
    expect(routeRequiredScope("PUT", "/api/nearby/settings")).toBe("nearby");
    expect(routeRequiredScope("POST", "/api/wallet/seed")).toBe("root");
    expect(normalizeMobileScopes(["root"])).not.toContain("root");
  });

  test("gateway restart requires the manage scope", () => {
    expect(routeRequiredScope("POST", "/api/system/restart")).toBe("manage");
  });

  test("fund-moving wallet ops require the wallet scope", () => {
    expect(routeRequiredScope("POST", "/api/wallet/send")).toBe("wallet");
    expect(routeRequiredScope("POST", "/api/wallet/sign")).toBe("wallet");
    expect(routeRequiredScope("POST", "/api/wallet/swap")).toBe("wallet");
  });

  test("wallet reads require read access and sensitive RPC configuration requires wallet access", () => {
    expect(routeRequiredScope("GET", "/api/wallet/status")).toBe("read");
    expect(routeRequiredScope("GET", "/api/wallet/rpc")).toBe("wallet");
    expect(routeRequiredScope("PUT", "/api/wallet/agent-policy")).toBe("wallet");
    expect(routeRequiredScope("PUT", "/api/wallet/agent-access")).toBe("wallet");
  });

  test("terminal execution requires the terminal scope", () => {
    expect(routeRequiredScope("POST", "/api/ide/open-terminal")).toBe("terminal");
    expect(routeRequiredScope("GET", "/api/browser/tabs/tab-1/stream")).toBe("terminal");
    expect(routeRequiredScope("GET", "/api/computer-use/preview")).toBe("terminal");
    expect(routeRequiredScope("DELETE", "/api/computer-use/preview")).toBe("terminal");
    expect(routeRequiredScope("GET", "/api/computer-use/trajectories")).toBe("terminal");
    expect(routeRequiredScope("GET", "/api/computer-use/trajectories/export")).toBe("terminal");
    expect(routeRequiredScope("POST", "/api/computer-use/trajectories/example/replay")).toBe(
      "terminal"
    );
  });

  test("MCP install, mutation, start, and tool calls require the mcp scope", () => {
    expect(routeRequiredScope("GET", "/api/mcp/registry/search")).toBe("read");
    expect(routeRequiredScope("POST", "/api/mcp/registry/install")).toBe("mcp");
    expect(routeRequiredScope("POST", "/api/mcp/abc/start")).toBe("mcp");
    expect(routeRequiredScope("POST", "/api/mcp/abc/call")).toBe("mcp");
    expect(routeRequiredScope("DELETE", "/api/mcp/abc")).toBe("mcp");
  });

  test("ordinary routes need no special scope", () => {
    expect(routeRequiredScope("GET", "/api/agents")).toBe("read");
    expect(routeRequiredScope("GET", "/api/mobile/device")).toBeNull();
    expect(routeRequiredScope("POST", "/api/mobile/push-token")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/mobile/push-preferences")).toBeNull();
  });

  test("chat, session, and artifact surfaces enforce read and chat scopes", () => {
    expect(routeRequiredScope("POST", "/api/chat")).toBe("chat");
    expect(routeRequiredScope("POST", "/api/chat/sessions/session-1/pending/reorder")).toBe("chat");
    expect(routeRequiredScope("GET", "/api/sessions/session-1")).toBe("read");
    expect(routeRequiredScope("GET", "/api/sessions/session-1/plan")).toBe("read");
    expect(routeRequiredScope("GET", "/api/sessions/session-1/artifacts")).toBe("read");
    expect(routeRequiredScope("GET", "/api/sessions/session-1/trajectories")).toBe("read");
    expect(routeRequiredScope("POST", "/api/sessions/session-1/fork")).toBe("chat");
    expect(routeRequiredScope("POST", "/api/sessions/session-1/golden")).toBe("chat");
    expect(routeRequiredScope("GET", "/api/evals")).toBe("read");
    expect(routeRequiredScope("GET", "/api/evals/export")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/evals/research/traces")).toBe("read");
    expect(routeRequiredScope("GET", "/api/evals/research/export")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/evals/benchmarks/export")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/evals/import")).toBe("manage");
    expect(routeRequiredScope("DELETE", "/api/evals/goldens/example")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/evals/run")).toBe("chat");
    expect(routeRequiredScope("PUT", "/api/evals/goldens/example/assertions")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/metrics/sessions")).toBe("read");
    expect(routeRequiredScope("DELETE", "/api/sessions/session-1/artifacts/file.md")).toBe("chat");
    expect(routeRequiredScope("GET", "/api/artifacts")).toBe("read");
    expect(routeRequiredScope("POST", "/api/artifacts")).toBe("chat");
    expect(routeRequiredScope("GET", "/api/logs/sessions/session-1/messages")).toBe("read");
  });

  test("custom scoped mobile tokens cannot mutate chat without the chat scope", () => {
    const previousApiKey = process.env.CYBARA_API_KEY;
    process.env.CYBARA_API_KEY = "cybara_scope_test_key";
    const { token } = createMobileDevice({
      baseUrl: "http://127.0.0.1:4269",
      scopes: ["read"],
    });
    try {
      const headers = { authorization: `Bearer ${token}` };

      const read = routeRequiredScope("GET", "/api/sessions/session-1/plan");
      expect(read).toBe("read");

      const allowed = securityCheck("GET", "/api/sessions/session-1/plan", headers, "10.1.2.3");
      expect(allowed.passed).toBe(true);

      const denied = securityCheck("POST", "/api/chat", headers, "10.1.2.3");
      expect(denied.passed).toBe(false);
      expect(denied.statusCode).toBe(403);
      expect(denied.error).toContain("'chat'");
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.CYBARA_API_KEY;
      } else {
        process.env.CYBARA_API_KEY = previousApiKey;
      }
    }
  });

  test("read-only mobile tokens cannot reach local mutation or browser automation", () => {
    const previousApiKey = process.env.CYBARA_API_KEY;
    process.env.CYBARA_API_KEY = "cybara_scope_test_key";
    const { token } = createMobileDevice({
      baseUrl: "http://127.0.0.1:4269",
      scopes: ["read"],
    });
    try {
      const headers = { authorization: `Bearer ${token}` };
      const write = securityCheck("POST", "/api/ide/write", headers, "10.1.2.3");
      const approve = securityCheck("POST", "/api/tools/approvals/resolve", headers, "10.1.2.3");
      const browser = securityCheck(
        "POST",
        "/api/browser/tabs/tab-1/navigate",
        headers,
        "10.1.2.3"
      );
      expect(write.passed).toBe(false);
      expect(write.error).toContain("'manage'");
      expect(approve.passed).toBe(false);
      expect(approve.error).toContain("'manage'");
      expect(browser.passed).toBe(false);
      expect(browser.error).toContain("'terminal'");
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.CYBARA_API_KEY;
      } else {
        process.env.CYBARA_API_KEY = previousApiKey;
      }
    }
  });

  test("mutating management surfaces require the manage scope", () => {
    expect(routeRequiredScope("GET", "/api/config")).toBe("read");
    expect(routeRequiredScope("PUT", "/api/config")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/web-research/settings")).toBe("read");
    expect(routeRequiredScope("PUT", "/api/web-research/settings")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/integration-credentials")).toBe("read");
    expect(routeRequiredScope("PUT", "/api/integration-credentials")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/migrations/sources")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/migrations/preview")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/migrations/run")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/providers")).toBe("read");
    expect(routeRequiredScope("POST", "/api/providers")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/providers/provider-1/test")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/agents/summary")).toBe("read");
    expect(routeRequiredScope("GET", "/api/router/config")).toBe("read");
    expect(routeRequiredScope("PUT", "/api/router/config")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/provider-plans/config")).toBe("read");
    expect(routeRequiredScope("GET", "/api/provider-plans/availability")).toBe("read");
    expect(routeRequiredScope("GET", "/api/provider-plans/status")).toBe("read");
    expect(routeRequiredScope("PUT", "/api/provider-plans/config")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/agents")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/tasks")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/channels")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/checkpoints")).toBe("root");
    expect(routeRequiredScope("POST", "/api/checkpoints")).toBe("root");
    expect(routeRequiredScope("POST", "/api/setup/complete")).toBe("manage");
  });

  test("narrow tokens cannot mutate local developer and agent state", () => {
    expect(routeRequiredScope("POST", "/api/tools/approvals/resolve")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/ide/write")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/ide/create")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/ide/replace")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/lsp/install")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/skills/install")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/memory")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/ide/read")).toBe("read");
    expect(routeRequiredScope("GET", "/api/lsp/definition")).toBe("read");
    expect(routeRequiredScope("GET", "/api/skills")).toBe("read");
    expect(routeRequiredScope("GET", "/api/memory")).toBe("read");
    expect(routeRequiredScope("GET", "/api/ws/status")).toBe("read");
    expect(routeRequiredScope("POST", "/api/browser/tabs/tab-1/navigate")).toBe("terminal");
    expect(routeRequiredScope("POST", "/api/simulators/android/action")).toBe("terminal");
  });

  test("unclassified and sensitive routes fail closed for scoped principals", () => {
    expect(routeRequiredScope("PUT", "/api/system-prompt")).toBe("manage");
    expect(routeRequiredScope("PUT", "/api/settings/tool-capabilities")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/git/branch")).toBe("manage");
    expect(routeRequiredScope("PUT", "/api/telemetry/settings")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/loops/run-1/cancel")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/system-prompt")).toBe("read");
    expect(routeRequiredScope("GET", "/api/metrics/sessions")).toBe("read");
    expect(routeRequiredScope("GET", "/api/logs/system")).toBe("read");
    expect(routeRequiredScope("POST", "/api/future-unclassified-route")).toBe("root");
  });

  test("read-only device tokens cannot mutate routes that were previously unclassified", () => {
    const previousApiKey = process.env.CYBARA_API_KEY;
    process.env.CYBARA_API_KEY = "cybara_scope_test_key";
    const { token } = createMobileDevice({
      baseUrl: "http://127.0.0.1:4269",
      scopes: ["read"],
    });
    try {
      const headers = { authorization: `Bearer ${token}` };
      const paths = [
        ["PUT", "/api/system-prompt"],
        ["PUT", "/api/settings/tool-capabilities"],
        ["POST", "/api/git/branch"],
        ["PUT", "/api/telemetry/settings"],
        ["POST", "/api/loops/run-1/cancel"],
        ["POST", "/api/future-unclassified-route"],
      ] as const;

      for (const [method, path] of paths) {
        const result = securityCheck(method, path, headers, "10.1.2.3");
        expect(result.passed).toBe(false);
        expect(result.statusCode).toBe(403);
      }

      expect(securityCheck("GET", "/api/metrics/sessions", headers, "10.1.2.3").passed).toBe(true);
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.CYBARA_API_KEY;
      } else {
        process.env.CYBARA_API_KEY = previousApiKey;
      }
    }
  });
});

describe("roles", () => {
  test("map to scope bundles; unknown roles return null", () => {
    expect(scopesForRole("full")).toEqual([
      "chat",
      "manage",
      "read",
      "wallet",
      "terminal",
      "mcp",
      "nearby",
    ]);
    expect(scopesForRole("standard")).toEqual(["chat", "manage", "read"]);
    expect(scopesForRole("readonly")).toEqual(["chat", "read"]);
    expect(scopesForRole("bogus")).toBeNull();
    expect(scopesForRole(undefined)).toBeNull();
  });
});

describe("mobile connect URL suggestions", () => {
  const interfaces = {
    en0: [
      {
        address: "192.168.1.20",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "192.168.1.20/24",
      },
    ],
  };

  test("promotes a LAN URL when the browser is on loopback", () => {
    const info = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "0.0.0.0",
      interfaces,
    });

    expect(info.baseUrl).toBe("http://192.168.1.20:4269");
    expect(info.currentBaseUrl).toBe("http://127.0.0.1:4269");
    expect(info.candidates).toContain("http://127.0.0.1:4269");
    expect(info.lanAccessEnabled).toBe(true);
    expect(info.isCurrentLoopback).toBe(true);
    expect(info.warnings.join(" ")).toContain("127.0.0.1");
    expect(info.troubleshooting.join(" ")).toContain("api/health");
  });

  test("prefers a Windows Wi-Fi LAN address over WSL and virtual adapter addresses", () => {
    const info = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "0.0.0.0",
      platform: "win32",
      interfaces: {
        "vEthernet (WSL)": [
          {
            address: "172.23.112.1",
            netmask: "255.255.240.0",
            family: "IPv4",
            mac: "00:00:00:00:00:02",
            internal: false,
            cidr: "172.23.112.1/20",
          },
        ],
        "Wi-Fi": [
          {
            address: "192.168.1.73",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:03",
            internal: false,
            cidr: "192.168.1.73/24",
          },
        ],
      },
    });

    expect(info.baseUrl).toBe("http://192.168.1.73:4269");
    expect(info.lanAddresses).toEqual(["192.168.1.73", "172.23.112.1"]);
    expect(info.candidates[0]).toBe("http://192.168.1.73:4269");
    expect(info.candidates).toContain("http://172.23.112.1:4269");
  });

  test("does not prefer LAN URLs until the gateway is LAN-bound", () => {
    const info = buildMobileConnectInfo({
      requestUrl: "http://localhost:5199/cybara/api/mobile/connect-info",
      configuredHost: "127.0.0.1",
      basePath: "/cybara",
      interfaces,
    });

    expect(info.baseUrl).toBe("http://localhost:5199/cybara");
    expect(info.candidates).toEqual([
      "http://localhost:5199/cybara",
      "http://192.168.1.20:5199/cybara",
    ]);
    expect(info.lanAccessEnabled).toBe(false);
    expect(info.warnings.join(" ")).toContain("Restart the gateway bound to a LAN address");
    expect(info.exposeCommand).toBe("CYBARA_HOST=192.168.1.20 cybara start");
  });

  test("adds Windows firewall diagnostics for LAN pairing", () => {
    const info = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "0.0.0.0",
      interfaces,
      platform: "win32",
    });

    expect(info.platform).toBe("win32");
    expect(info.firewallCommand).toContain("New-NetFirewallRule");
    expect(info.firewallCommand).toContain("-LocalPort 4269");
    expect(info.firewallCommand).toContain("-Profile Any");
    expect(info.warnings.join(" ")).toContain("Windows Firewall");
    expect(info.troubleshooting.join(" ")).toContain("Private-only rule");
  });

  test("allows an explicit mobile base URL to override detected interfaces", () => {
    const info = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "127.0.0.1",
      mobileBaseUrl: "https://cybara.example.com/tunnel/",
      interfaces: {},
    });

    expect(info.baseUrl).toBe("https://cybara.example.com/tunnel");
    expect(info.candidates[0]).toBe("https://cybara.example.com/tunnel");
    expect(isLoopbackMobileGatewayUrl("http://127.0.0.1:4269")).toBe(true);
    expect(isLoopbackMobileGatewayUrl("http://192.168.1.20:4269")).toBe(false);
  });

  test("remote access candidate works without LAN only when ready", () => {
    const pending = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "127.0.0.1",
      remoteAccess: {
        enabled: true,
        mode: "public_tunnel",
        provider: "cloudflare",
        baseUrl: "https://cybara.example.com",
        ready: false,
        requiresGatewayPassword: true,
        status: "needs_password",
        message: "Enable password first.",
      },
      interfaces: {},
    });
    expect(pending.baseUrl).toBe("https://cybara.example.com");
    expect(pending.remoteAccess.ready).toBe(false);
    expect(validateMobilePairingBaseUrl("https://cybara.example.com", pending).ok).toBe(false);

    const ready = buildMobileConnectInfo({
      requestUrl: "http://127.0.0.1:4269/api/mobile/connect-info",
      configuredHost: "127.0.0.1",
      remoteAccess: {
        enabled: true,
        mode: "public_tunnel",
        provider: "cloudflare",
        baseUrl: "https://cybara.example.com",
        ready: true,
        requiresGatewayPassword: true,
        status: "ready",
        message: "Ready.",
      },
      interfaces: {},
    });
    expect(validateMobilePairingBaseUrl("https://cybara.example.com", ready).ok).toBe(true);
    expect(validateMobilePairingBaseUrl("https://other.example.com", ready).ok).toBe(false);
  });
});

describe("expiring one-time pairing codes", () => {
  test("a code redeems once for a scoped device token", () => {
    const { code, payload } = createPairingCode({
      baseUrl: "http://127.0.0.1:4269",
      role: "readonly",
    });
    expect(payload.protocol).toBe("cybara-mobile-pair-v1");
    expect(payload.code).toBe(code);

    const redeemed = redeemPairingCode(code);
    expect(redeemed).not.toBeNull();
    expect(redeemed?.token).toMatch(/^cybara_mobile_/);
    // the device inherits the code's role scopes
    const view = authenticateMobileDeviceToken(redeemed!.token);
    expect(view?.scopes.sort()).toEqual(["chat", "read"]);
  });

  test("a code cannot be redeemed twice (one-time)", () => {
    const { code } = createPairingCode({ baseUrl: "http://127.0.0.1:4269" });
    expect(redeemPairingCode(code)).not.toBeNull();
    expect(redeemPairingCode(code)).toBeNull();
  });

  test("an expired code is rejected", async () => {
    const { code } = createPairingCode({
      baseUrl: "http://127.0.0.1:4269",
      ttlMs: 1,
    });
    await delay(10);
    expect(redeemPairingCode(code)).toBeNull();
  });

  test("an unknown code is rejected", () => {
    expect(redeemPairingCode("NOPE-NOPE")).toBeNull();
  });

  test("redemption is case- and whitespace-insensitive on the code", () => {
    const { code } = createPairingCode({ baseUrl: "http://127.0.0.1:4269" });
    expect(redeemPairingCode(`  ${code.toLowerCase()}  `)).not.toBeNull();
  });
});
