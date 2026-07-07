import { afterEach, describe, expect, test } from "bun:test";
import {
  createMobileDevice,
  createPairingCode,
  buildMobileConnectInfo,
  redeemPairingCode,
  authenticateMobileDeviceToken,
  getMobileDeviceStorePath,
  isLoopbackMobileGatewayUrl,
  scopesForRole,
  DEFAULT_MOBILE_SCOPES,
  normalizeMobileScopes,
  resetMobileDeviceStoreForTests,
} from "../../src/core/mobile-devices";
import { secureDir } from "../../src/core/paths";
import { routeRequiredScope } from "../../src/api/security";

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
});

describe("route scope requirements", () => {
  test("gateway auth management requires a scope no device can hold", () => {
    expect(routeRequiredScope("GET", "/api/auth/settings")).toBe("root");
    expect(routeRequiredScope("PUT", "/api/auth/settings")).toBe("root");
    expect(routeRequiredScope("GET", "/api/auth/key")).toBe("root");
    expect(routeRequiredScope("POST", "/api/auth/rotate-key")).toBe("root");
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

  test("wallet reads are not gated, but policy/access mutations require wallet scope", () => {
    expect(routeRequiredScope("GET", "/api/wallet/status")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/wallet/agent-policy")).toBe("wallet");
    expect(routeRequiredScope("PUT", "/api/wallet/agent-access")).toBe("wallet");
  });

  test("terminal execution requires the terminal scope", () => {
    expect(routeRequiredScope("POST", "/api/ide/open-terminal")).toBe("terminal");
  });

  test("MCP install, mutation, start, and tool calls require the mcp scope", () => {
    expect(routeRequiredScope("GET", "/api/mcp/registry/search")).toBeNull();
    expect(routeRequiredScope("POST", "/api/mcp/registry/install")).toBe("mcp");
    expect(routeRequiredScope("POST", "/api/mcp/abc/start")).toBe("mcp");
    expect(routeRequiredScope("POST", "/api/mcp/abc/call")).toBe("mcp");
    expect(routeRequiredScope("DELETE", "/api/mcp/abc")).toBe("mcp");
  });

  test("ordinary routes need no special scope", () => {
    expect(routeRequiredScope("POST", "/api/chat")).toBeNull();
    expect(routeRequiredScope("GET", "/api/agents")).toBeNull();
  });

  test("mutating management surfaces require the manage scope", () => {
    expect(routeRequiredScope("GET", "/api/config")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/config")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/migrations/sources")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/migrations/preview")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/migrations/run")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/providers")).toBeNull();
    expect(routeRequiredScope("POST", "/api/providers")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/providers/provider-1/test")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/router/config")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/router/config")).toBe("manage");
    expect(routeRequiredScope("GET", "/api/provider-plans/config")).toBeNull();
    expect(routeRequiredScope("GET", "/api/provider-plans/status")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/provider-plans/config")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/agents")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/tasks")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/channels")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/checkpoints")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/setup/complete")).toBe("manage");
  });
});

describe("roles", () => {
  test("map to scope bundles; unknown roles return null", () => {
    expect(scopesForRole("full")).toEqual(["chat", "manage", "read", "wallet", "terminal", "mcp"]);
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
    expect(info.warnings.join(" ")).toContain("Windows Firewall");
    expect(info.troubleshooting.join(" ")).toContain("Private");
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
    const { code } = createPairingCode({ baseUrl: "http://127.0.0.1:4269", ttlMs: 1 });
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
