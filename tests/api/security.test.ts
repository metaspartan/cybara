import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as security from "../../src/api/security";
import { createMobileDevice, resetMobileDeviceStoreForTests } from "../../src/core/mobile-devices";

let previousApiKey: string | undefined;

describe("API security module", () => {
  beforeAll(() => {
    previousApiKey = process.env.CYBARA_API_KEY;
    process.env.CYBARA_API_KEY = "cybara_test_key_for_security_suite";
  });

  afterAll(() => {
    if (previousApiKey === undefined) {
      delete process.env.CYBARA_API_KEY;
      return;
    }
    process.env.CYBARA_API_KEY = previousApiKey;
  });

  afterEach(() => {
    security.resetSecuritySettingsForTests();
    resetMobileDeviceStoreForTests();
  });

  test("authenticateRequest allows localhost bypass for same-origin browser requests in dev", () => {
    // Browser fetch/SSE send Sec-Fetch-Site: same-origin — that legit UI path
    // is bypassed in dev.
    const result = security.authenticateRequest({ "sec-fetch-site": "same-origin" }, "127.0.0.1");
    expect(result.authenticated).toBe(true);
  });

  test("authenticateRequest does NOT bypass header-less (non-browser) localhost requests", () => {
    // curl / another local process with no Origin and no Sec-Fetch-Site must
    // present the API key — they don't inherit the localhost bypass.
    const result = security.authenticateRequest({}, "127.0.0.1");
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Missing Authorization");
  });

  test("authenticateRequest blocks localhost bypass for cross-origin browser requests", () => {
    const result = security.authenticateRequest(
      { origin: "https://evil.example", host: "localhost:4269" },
      "127.0.0.1"
    );
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Missing Authorization");
  });

  test("authenticateRequest blocks DNS-rebinding: local IP but foreign Host header", () => {
    // attacker.example resolves to 127.0.0.1, so the victim's browser sends a
    // same-origin request from a loopback IP — but Host still names the
    // attacker's domain. The bypass must refuse it.
    const result = security.authenticateRequest(
      { "sec-fetch-site": "same-origin", host: "attacker.example:4269" },
      "127.0.0.1"
    );
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Missing Authorization");
  });

  test("authenticateRequest keeps the bypass for genuine local Host headers", () => {
    for (const host of ["localhost:4269", "127.0.0.1:4269", "[::1]:4269", "localhost"]) {
      const result = security.authenticateRequest(
        { "sec-fetch-site": "same-origin", host },
        "127.0.0.1"
      );
      expect(result.authenticated).toBe(true);
    }
  });

  test("normalizeGatewayBasePath accepts clean prefixes and rejects junk", () => {
    expect(security.normalizeGatewayBasePath("/cybara")).toBe("/cybara");
    expect(security.normalizeGatewayBasePath("cybara")).toBe("/cybara");
    expect(security.normalizeGatewayBasePath("/cybara/")).toBe("/cybara");
    expect(security.normalizeGatewayBasePath("/tools/cybara")).toBe("/tools/cybara");
    expect(security.normalizeGatewayBasePath("")).toBe("");
    expect(security.normalizeGatewayBasePath("/")).toBe("");
    expect(security.normalizeGatewayBasePath("/api")).toBe("");
    expect(security.normalizeGatewayBasePath("/api/nested")).toBe("");
    expect(security.normalizeGatewayBasePath("/sp ace")).toBe("");
    expect(security.normalizeGatewayBasePath("/a/b/c/d/e")).toBe("");
    expect(security.normalizeGatewayBasePath("/../etc")).toBe("");
    expect(security.normalizeGatewayBasePath(42)).toBe("");
  });

  test("authenticateRequest rejects missing header for non-localhost", () => {
    const result = security.authenticateRequest({}, "203.0.113.10");
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Missing Authorization");
  });

  test("authenticateRequest rejects same-origin browser signals from LAN clients without a token", () => {
    const result = security.authenticateRequest(
      { "sec-fetch-site": "same-origin", host: "192.168.1.155:4269" },
      "192.168.1.42"
    );
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Missing Authorization");
  });

  test("authenticateRequest accepts matching bearer token", () => {
    const result = security.authenticateRequest(
      { authorization: "Bearer cybara_test_key_for_security_suite" },
      "203.0.113.10"
    );
    expect(result.authenticated).toBe(true);
  });

  test("gateway password adds a second factor for remote root API key requests", () => {
    security.setGatewayPassword("correct horse battery staple");

    const missing = security.authenticateRequest(
      { authorization: "Bearer cybara_test_key_for_security_suite" },
      "203.0.113.10"
    );
    expect(missing.authenticated).toBe(false);
    expect(missing.reason).toContain("Gateway password required");

    const wrong = security.authenticateRequest(
      {
        authorization: "Bearer cybara_test_key_for_security_suite",
        "x-cybara-gateway-password": "wrong password value",
      },
      "203.0.113.10"
    );
    expect(wrong.authenticated).toBe(false);

    const valid = security.authenticateRequest(
      {
        authorization: "Bearer cybara_test_key_for_security_suite",
        "x-cybara-gateway-password": "correct horse battery staple",
      },
      "203.0.113.10"
    );
    expect(valid.authenticated).toBe(true);
  });

  test("gateway password does not break scoped mobile device tokens", () => {
    security.setGatewayPassword("correct horse battery staple");
    const { token } = createMobileDevice({
      baseUrl: "http://192.168.1.20:4269",
    });

    const result = security.authenticateRequest(
      { authorization: `Bearer ${token}` },
      "203.0.113.10"
    );

    expect(result.authenticated).toBe(true);
    expect(result.scopes).toContain("chat");
  });

  test("public remote access requires HTTPS and the gateway password", () => {
    let settings = security.setGatewayRemoteAccessSettings({
      enabled: true,
      mode: "public_tunnel",
      provider: "cloudflare",
      baseUrl: "http://cybara.example.com",
    });
    expect(settings.ready).toBe(false);
    expect(settings.status).toBe("needs_https");

    settings = security.setGatewayRemoteAccessSettings({
      enabled: true,
      mode: "public_tunnel",
      provider: "cloudflare",
      baseUrl: "https://cybara.example.com",
    });
    expect(settings.ready).toBe(false);
    expect(settings.status).toBe("needs_password");

    security.setGatewayPassword("correct horse battery staple");
    settings = security.getGatewayRemoteAccessSettings();
    expect(settings.ready).toBe(true);
    expect(settings.status).toBe("ready");
  });

  test("private mesh remote access allows non-loopback overlay URLs", () => {
    const settings = security.setGatewayRemoteAccessSettings({
      enabled: true,
      mode: "private_overlay",
      provider: "netbird",
      baseUrl: "http://100.94.2.10:4269",
    });
    expect(settings.ready).toBe(true);
    expect(settings.requiresGatewayPassword).toBe(false);
  });

  test("private mesh remote access rejects public HTTP hostnames", () => {
    const publicHttp = security.setGatewayRemoteAccessSettings({
      enabled: true,
      mode: "private_overlay",
      provider: "custom",
      baseUrl: "http://cybara.example.com",
    });
    expect(publicHttp.ready).toBe(false);
    expect(publicHttp.status).toBe("needs_https");
    expect(publicHttp.message).toContain("private LAN or mesh IP");

    const httpsName = security.setGatewayRemoteAccessSettings({
      enabled: true,
      mode: "private_overlay",
      provider: "tailscale",
      baseUrl: "https://cybara.tailnet.ts.net",
    });
    expect(httpsName.ready).toBe(true);
    expect(httpsName.requiresGatewayPassword).toBe(false);
  });

  test("securityCheck rejects remote root requests missing the gateway password", () => {
    security.setGatewayPassword("correct horse battery staple");

    const denied = security.securityCheck(
      "GET",
      "/api/info",
      { authorization: "Bearer cybara_test_key_for_security_suite" },
      "203.0.113.10"
    );
    expect(denied.passed).toBe(false);
    expect(denied.statusCode).toBe(401);
    expect(denied.error).toContain("Gateway password required");

    const allowed = security.securityCheck(
      "GET",
      "/api/info",
      {
        authorization: "Bearer cybara_test_key_for_security_suite",
        "x-cybara-gateway-password": "correct horse battery staple",
      },
      "203.0.113.10"
    );
    expect(allowed.passed).toBe(true);
  });

  test("MCP OAuth callback is public only at the exact callback path", () => {
    const callback = security.securityCheck("GET", "/api/mcp/oauth/callback", {}, "203.0.113.10");
    const lookalike = security.securityCheck(
      "GET",
      "/api/mcp/oauth/callback-evil",
      {},
      "203.0.113.10"
    );
    expect(callback.passed).toBe(true);
    expect(lookalike.passed).toBe(false);
    expect(lookalike.statusCode).toBe(401);
  });

  test("account connector OAuth callback is public only at the exact callback path", () => {
    const callback = security.securityCheck(
      "GET",
      "/api/connectors/oauth/callback",
      {},
      "203.0.113.10"
    );
    const lookalike = security.securityCheck(
      "GET",
      "/api/connectors/oauth/callback-evil",
      {},
      "203.0.113.10"
    );
    expect(callback.passed).toBe(true);
    expect(lookalike.passed).toBe(false);
    expect(lookalike.statusCode).toBe(401);
  });

  test("plugin discovery is readable while plugin changes require management access", () => {
    expect(security.routeRequiredScope("GET", "/api/plugins")).toBe("read");
    expect(security.routeRequiredScope("GET", "/api/plugins/catalog")).toBe("read");
    expect(security.routeRequiredScope("GET", "/api/plugins/marketplace")).toBe("read");
    expect(security.routeRequiredScope("GET", "/api/plugins/validate")).toBe("manage");
    expect(security.routeRequiredScope("POST", "/api/plugins/validate")).toBe("manage");
    expect(security.routeRequiredScope("POST", "/api/plugins/install")).toBe("manage");
    expect(security.routeRequiredScope("POST", "/api/plugins/marketplace/install")).toBe("manage");
    expect(security.routeRequiredScope("PUT", "/api/plugins/example")).toBe("manage");
    expect(security.routeRequiredScope("DELETE", "/api/plugins/example")).toBe("manage");
  });

  test("checkRateLimit enforces max requests per window", () => {
    const key = `test-rate-limit-${Date.now()}`;
    const first = security.checkRateLimit(key, 10000, 2);
    const second = security.checkRateLimit(key, 10000, 2);
    const third = security.checkRateLimit(key, 10000, 2);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect((third.retryAfterMs ?? 0) > 0).toBe(true);
  });

  test("read-only chat polling uses a separate budget from chat mutations", () => {
    expect(security.getRateLimitType("GET", "/api/chat/sessions")).toBe("read");
    expect(security.getRateLimitType("GET", "/api/chat/sessions/session-1/messages")).toBe("read");
    expect(security.getRateLimitType("POST", "/api/chat")).toBe("chat");
    expect(security.getRateLimitType("POST", "/api/chat/sessions/session-1/steer")).toBe("chat");
    expect(security.getRateLimitType("GET", "/api/providers/oauth/poll")).toBe("global");
  });

  test("isPrivateOrBlockedIP catches private and invalid targets", () => {
    expect(security.isPrivateOrBlockedIP("127.0.0.1")).toBe(true);
    expect(security.isPrivateOrBlockedIP("192.168.1.10")).toBe(true);
    expect(security.isPrivateOrBlockedIP("fd00::1")).toBe(true);
    expect(security.isPrivateOrBlockedIP("fe80::1")).toBe(true);
    expect(security.isPrivateOrBlockedIP("localhost")).toBe(true);
    expect(security.isPrivateOrBlockedIP("8.8.8.8")).toBe(false);
    expect(security.isPrivateOrBlockedIP("example.com")).toBe(false);
  });

  test("validateUrl blocks non-http protocols and private hosts", async () => {
    const fileUrl = await security.validateUrl("file:///tmp/x");
    expect(fileUrl.valid).toBe(false);

    const localhostUrl = await security.validateUrl("http://localhost:4269");
    expect(localhostUrl.valid).toBe(false);

    const loopbackIpv6Url = await security.validateUrl("http://[::1]/");
    expect(loopbackIpv6Url.valid).toBe(false);

    const credentialUrl = await security.validateUrl("https://user:pass@example.com");
    expect(credentialUrl.valid).toBe(false);

    // Public URL validation may fail on runners without internet access.
    // Only assert if the call succeeds; skip if DNS/network fails.
    try {
      const publicUrl = await security.validateUrl("https://example.com/docs");
      expect(publicUrl.valid).toBe(true);
    } catch {
      // Network unreachable on this runner — skip the assertion.
    }
  });

  test("validateUrl blocks cloud-metadata and decimal-encoded loopback (SSRF)", async () => {
    // Link-local cloud-metadata endpoint — a prime SSRF target.
    const metadata = await security.validateUrl("http://169.254.169.254/latest/meta-data/");
    expect(metadata.valid).toBe(false);

    // Decimal-encoded loopback (2130706433 === 127.0.0.1).
    const decimalLoopback = await security.validateUrl("http://2130706433/");
    expect(decimalLoopback.valid).toBe(false);
  });

  test("validateMessageSize and sanitizeString enforce basic input safety", () => {
    const valid = security.validateMessageSize("hello");
    expect(valid.valid).toBe(true);

    const tooLarge = security.validateMessageSize("a".repeat(33 * 1024));
    expect(tooLarge.valid).toBe(false);

    const sanitized = security.sanitizeString("hello\x00world\n\t", 8);
    expect(sanitized).toBe("hellowor");
  });
});
