import { afterEach, describe, expect, test } from "bun:test";
import {
  createMobileDevice,
  authenticateMobileDeviceToken,
  DEFAULT_MOBILE_SCOPES,
  normalizeMobileScopes,
  resetMobileDeviceStoreForTests,
} from "../../src/core/mobile-devices";
import { routeRequiredScope } from "../../src/api/security";

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
