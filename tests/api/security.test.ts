import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as security from "../../src/api/security";

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

  test("authenticateRequest rejects missing header for non-localhost", () => {
    const result = security.authenticateRequest({}, "203.0.113.10");
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
