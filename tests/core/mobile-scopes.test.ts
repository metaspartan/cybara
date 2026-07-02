import { afterEach, describe, expect, test } from "bun:test";
import {
  createMobileDevice,
  createPairingCode,
  redeemPairingCode,
  authenticateMobileDeviceToken,
  scopesForRole,
  DEFAULT_MOBILE_SCOPES,
  normalizeMobileScopes,
  resetMobileDeviceStoreForTests,
} from "../../src/core/mobile-devices";
import { routeRequiredScope } from "../../src/api/security";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  resetMobileDeviceStoreForTests();
});

describe("mobile device scopes", () => {
  test("new pairings default to limited scopes (no wallet/terminal)", () => {
    const { token } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });
    const view = authenticateMobileDeviceToken(token);
    expect(view?.scopes.sort()).toEqual([...DEFAULT_MOBILE_SCOPES].sort());
    expect(view?.scopes).not.toContain("wallet");
    expect(view?.scopes).not.toContain("terminal");
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
  test("fund-moving wallet ops require the wallet scope", () => {
    expect(routeRequiredScope("POST", "/api/wallet/send")).toBe("wallet");
    expect(routeRequiredScope("POST", "/api/wallet/sign")).toBe("wallet");
    expect(routeRequiredScope("POST", "/api/wallet/swap")).toBe("wallet");
  });

  test("wallet reads and policy/access management are not gated", () => {
    expect(routeRequiredScope("GET", "/api/wallet/status")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/wallet/agent-policy")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/wallet/agent-access")).toBeNull();
  });

  test("terminal execution requires the terminal scope", () => {
    expect(routeRequiredScope("POST", "/api/ide/open-terminal")).toBe("terminal");
  });

  test("ordinary routes need no special scope", () => {
    expect(routeRequiredScope("POST", "/api/chat")).toBeNull();
    expect(routeRequiredScope("PUT", "/api/config")).toBeNull();
    expect(routeRequiredScope("GET", "/api/agents")).toBeNull();
  });
});

describe("roles", () => {
  test("map to scope bundles; unknown roles return null", () => {
    expect(scopesForRole("full")).toEqual(["chat", "manage", "read", "wallet", "terminal"]);
    expect(scopesForRole("standard")).toEqual(["chat", "manage", "read"]);
    expect(scopesForRole("readonly")).toEqual(["chat", "read"]);
    expect(scopesForRole("bogus")).toBeNull();
    expect(scopesForRole(undefined)).toBeNull();
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
