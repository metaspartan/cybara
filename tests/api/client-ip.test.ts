import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forwardedClientIp, getClientIp, isLoopbackIp } from "../../src/api/client-ip";
import * as security from "../../src/api/security";

let previousApiKey: string | undefined;

beforeAll(() => {
  previousApiKey = process.env.CYBARA_API_KEY;
  process.env.CYBARA_API_KEY = "cybara_test_key_for_client_ip_suite";
});

afterAll(() => {
  if (previousApiKey === undefined) {
    delete process.env.CYBARA_API_KEY;
    return;
  }
  process.env.CYBARA_API_KEY = previousApiKey;
});

describe("client IP resolution", () => {
  test("uses the direct peer for normal local browser requests", () => {
    expect(getClientIp({ "sec-fetch-site": "same-origin" }, "127.0.0.1")).toBe("127.0.0.1");
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
  });

  test("does not trust forwarded addresses without explicit proxy trust", () => {
    const headers = {
      host: "cybara.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.42",
    };
    const clientIp = getClientIp(headers, "127.0.0.1", { trustProxy: false });

    expect(clientIp).toBe("127.0.0.1");
    expect(security.authenticateRequest(headers, clientIp).authenticated).toBe(false);
  });

  test("uses forwarded addresses from explicitly trusted same-host proxies", () => {
    expect(
      getClientIp({ "x-forwarded-for": "203.0.113.42" }, "127.0.0.1", { trustProxy: true })
    ).toBe("203.0.113.42");
  });

  test("trustProxy mode honors the first forwarded address", () => {
    expect(
      getClientIp({ "X-Forwarded-For": "198.51.100.7, 127.0.0.1" }, "10.0.0.8", {
        trustProxy: true,
      })
    ).toBe("198.51.100.7");
    expect(forwardedClientIp({ "x-real-ip": "198.51.100.8" })).toBe("198.51.100.8");
  });

  test("trustProxy mode cannot manufacture loopback from a remote direct peer", () => {
    expect(getClientIp({ "x-forwarded-for": "127.0.0.1" }, "10.0.0.8", { trustProxy: true })).toBe(
      "10.0.0.8"
    );
  });

  test("ignores forwarded loopback spoofing from a local direct client", () => {
    expect(
      getClientIp({ "x-forwarded-for": "127.0.0.2" }, "127.0.0.1", { trustProxy: false })
    ).toBe("127.0.0.1");
  });

  test("fails closed when a direct peer address is unavailable", () => {
    expect(getClientIp({ "x-forwarded-for": "127.0.0.1" })).toBe("0.0.0.0");
    expect(
      security.authenticateRequest({ "sec-fetch-site": "same-origin" }, "0.0.0.0").authenticated
    ).toBe(false);
  });
});
