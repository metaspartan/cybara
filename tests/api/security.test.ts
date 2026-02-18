import { beforeAll, describe, expect, test } from "bun:test";

type SecurityModule = typeof import("../../src/api/security");

let security: SecurityModule;

describe("API security module", () => {
  beforeAll(async () => {
    const prior = process.env.CYBARA_API_KEY;
    process.env.CYBARA_API_KEY = "cybara_test_key_for_security_suite";
    security = (await import(`../../src/api/security?test=${Date.now()}`)) as SecurityModule;
    if (prior === undefined) {
      delete process.env.CYBARA_API_KEY;
    } else {
      process.env.CYBARA_API_KEY = prior;
    }
  });

  test("authenticateRequest allows localhost bypass in dev", () => {
    const result = security.authenticateRequest({}, "127.0.0.1");
    expect(result.authenticated).toBe(true);
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

    const publicUrl = await security.validateUrl("https://example.com/docs");
    expect(publicUrl.valid).toBe(true);
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
