import { describe, expect, test } from "bun:test";
import {
  classifyApiError,
  isTransientStatus,
  summarizeClassifiedError,
} from "../../src/core/error-classifier";

describe("classifyApiError", () => {
  test("classifies 401/403 as auth (rotate, not retry)", () => {
    expect(classifyApiError({ status: 401 }).category).toBe("auth");
    expect(classifyApiError({ status: 403 }).category).toBe("auth");
    const c = classifyApiError({ status: 401 });
    expect(c.retryable).toBe(false);
    expect(c.rotateCredential).toBe(true);
  });

  test("classifies billing/quota via body text and 402", () => {
    expect(classifyApiError({ status: 402 }).category).toBe("billing");
    expect(classifyApiError({ body: "insufficient quota" }).category).toBe("billing");
    expect(classifyApiError({ body: "exceeded your credit limit" }).category).toBe("billing");
    expect(classifyApiError({ body: "billing" }).rotateCredential).toBe(true);
  });

  test("classifies 429 as rate_limit (retryable + rotate)", () => {
    const c = classifyApiError({ status: 429 });
    expect(c.category).toBe("rate_limit");
    expect(c.retryable).toBe(true);
    expect(c.rotateCredential).toBe(true);
  });

  test("classifies 529/overloaded as retryable without rotation", () => {
    expect(classifyApiError({ status: 529 }).category).toBe("overloaded");
    expect(classifyApiError({ status: 529 }).retryable).toBe(true);
    expect(classifyApiError({ status: 529 }).rotateCredential).toBe(false);
    expect(classifyApiError({ body: "overloaded" }).category).toBe("overloaded");
  });

  test("classifies context-too-long and suggests reducing context", () => {
    const c = classifyApiError({ body: "context length exceeded the maximum" });
    expect(c.category).toBe("context_too_long");
    expect(c.reduceContext).toBe(true);
    expect(c.retryable).toBe(false);
  });

  test("classifies timeouts and network errors as retryable", () => {
    expect(classifyApiError({ status: 408 }).category).toBe("timeout");
    expect(classifyApiError({ error: new Error("fetch failed: ECONNRESET") }).category).toBe("network");
    expect(classifyApiError({ error: new Error("Operation timed out") }).retryable).toBe(true);
  });

  test("classifies 4xx (non-auth) as bad_request, not retryable", () => {
    const c = classifyApiError({ status: 400, body: "malformed" });
    expect(c.category).toBe("bad_request");
    expect(c.retryable).toBe(false);
  });

  test("classifies 5xx as server_error, retryable", () => {
    const c = classifyApiError({ status: 503 });
    expect(c.category).toBe("server_error");
    expect(c.retryable).toBe(true);
  });

  test("auth body text is detected even with a non-401 status", () => {
    expect(classifyApiError({ body: "invalid_api_key provided" }).category).toBe("auth");
  });

  test("summarizeClassifiedError returns a non-empty message for every category", () => {
    const categories = [
      "auth",
      "billing",
      "rate_limit",
      "overloaded",
      "context_too_long",
      "timeout",
      "network",
      "server_error",
      "bad_request",
      "unknown",
    ] as const;
    for (const category of categories) {
      const msg = summarizeClassifiedError({
        category,
        retryable: false,
        rotateCredential: false,
        reduceContext: false,
        message: "x",
      });
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe("isTransientStatus", () => {
  test("treats 429, 5xx, 520, 529 as transient", () => {
    for (const s of [429, 500, 502, 503, 520, 529]) {
      expect(isTransientStatus(s)).toBe(true);
    }
  });
  test("does not treat 2xx/4xx (except 429) as transient", () => {
    for (const s of [200, 301, 400, 401, 403, 404, 408]) {
      expect(isTransientStatus(s)).toBe(false);
    }
  });
});
