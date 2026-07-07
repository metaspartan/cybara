import { describe, expect, test } from "bun:test";
import { assertCountableTable } from "../../src/api/queries";
import { constantTimeEqual } from "../../src/core/channels/constant-time";
import { verifyWebhookSignature } from "../../src/core/channels/adapters/webhook";
import { isProtectedEnvKey } from "../../src/core/tools/handlers/env";
import { applyReplacements } from "../../src/api/ide-api";
import { escapeHtml } from "../../src/api/html-escape";
import { createHmac } from "crypto";

describe("SQL table-name allowlist (countRows/countSince)", () => {
  test("accepts known log tables", () => {
    expect(assertCountableTable("system_logs")).toBe("system_logs");
    expect(assertCountableTable("session_messages")).toBe("session_messages");
  });

  test("rejects injection attempts and unknown tables", () => {
    expect(() => assertCountableTable("system_logs; DROP TABLE agents;--")).toThrow(
      "Invalid table name"
    );
    expect(() => assertCountableTable("providers")).toThrow("Invalid table name");
    expect(() => assertCountableTable("")).toThrow("Invalid table name");
  });
});

describe("constant-time comparison", () => {
  test("matches equal strings and rejects different ones", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    expect(constantTimeEqual("short", "longer-value")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("webhook signature verification", () => {
  const secret = "s3cr3t";
  const body = '{"event":"ping"}';
  const good = createHmac("sha256", secret).update(body).digest("hex");

  test("accepts a valid signature (with and without sha256= prefix)", () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${good}`, secret)).toBe(true);
  });

  test("rejects a forged or missing signature", () => {
    expect(verifyWebhookSignature(body, "deadbeef", secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(`${body} tampered`, good, secret)).toBe(false);
  });
});

describe("env tool protected keys", () => {
  test("blocks secrets and security-critical operational vars", () => {
    expect(isProtectedEnvKey("CYBARA_API_KEY")).toBe(true);
    expect(isProtectedEnvKey("CYBARA_REQUIRE_AUTH")).toBe(true);
    expect(isProtectedEnvKey("CYBARA_TRUST_PROXY")).toBe(true);
    expect(isProtectedEnvKey("PATH")).toBe(true);
    expect(isProtectedEnvKey("NODE_OPTIONS")).toBe(true);
    expect(isProtectedEnvKey("OPENAI_API_KEY")).toBe(true);
    expect(isProtectedEnvKey("AWS_SECRET_ACCESS_KEY")).toBe(true);
    expect(isProtectedEnvKey("DYLD_INSERT_LIBRARIES")).toBe(true);
  });

  test("allows innocuous vars", () => {
    expect(isProtectedEnvKey("MY_FEATURE_FLAG")).toBe(false);
    expect(isProtectedEnvKey("EDITOR")).toBe(false);
  });
});

describe("escapeHtml", () => {
  test("escapes HTML metacharacters", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml("a & b's")).toBe("a &amp; b&#39;s");
  });
});

describe("applyReplacements capture groups", () => {
  test("regex mode expands $1/$2 capture groups", () => {
    const r = applyReplacements("a=1;b=2", "(\\w+)=(\\w+)", "$2=$1", { useRegex: true });
    expect(r.content).toBe("1=a;2=b");
    expect(r.replacements).toBe(2);
  });

  test("regex mode expands $& (whole match)", () => {
    const r = applyReplacements("foo bar", "\\w+", "[$&]", { useRegex: true });
    expect(r.content).toBe("[foo] [bar]");
  });

  test("literal mode treats replacement verbatim (no $ expansion)", () => {
    const r = applyReplacements("price is X", "X", "$100", {});
    expect(r.content).toBe("price is $100");
    expect(r.replacements).toBe(1);
  });

  test("returns zero when nothing matches", () => {
    const r = applyReplacements("hello", "zzz", "y", {});
    expect(r).toEqual({ content: "hello", replacements: 0 });
  });
});
