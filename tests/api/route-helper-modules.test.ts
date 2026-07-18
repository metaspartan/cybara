import { describe, expect, test } from "bun:test";
import {
  validateProviderBaseUrlShape,
  validateProviderCredentialShape,
} from "../../src/api/routes/provider-validation";
import {
  buildCorsHeaders,
  logRequest,
  parseBoundedQueryNumber,
  redactSecretConfig,
  requestLogs,
  securityHeaders,
} from "../../src/api/routes/request-runtime";
import {
  normalizeDefinitionLocation,
  normalizeLspSymbol,
  sanitizeInlineCompletion,
  truncateInlineContext,
} from "../../src/api/routes/lsp-ide";
import { formatSkillInstallSpec } from "../../src/api/routes/skill-formatting";
import {
  extractScreenshotPathFromText,
  sanitizeToolMediaResult,
} from "../../src/core/tool-media-result";

describe("route helper modules", () => {
  test("validates provider credentials and base URLs before persistence", () => {
    expect(() =>
      validateProviderCredentialShape("openai", { apiKey: "not-an-openai-key" })
    ).toThrow("OpenAI API key");
    expect(() =>
      validateProviderCredentialShape("google", { apiKey: "https://example.com/key" })
    ).toThrow("Google API key looks like a URL");
    expect(() => validateProviderBaseUrlShape("ftp://example.com")).toThrow("http or https");
    expect(() => validateProviderBaseUrlShape("https://user:pass@example.com")).toThrow(
      "embedded credentials"
    );
  });

  test("keeps request runtime helpers bounded and redacted", () => {
    const startLength = requestLogs.length;
    logRequest({
      timestamp: "2026-01-01T00:00:00.000Z",
      method: "GET",
      path: "/api/test",
      status: 200,
      durationMs: 1,
    });

    expect(requestLogs.length).toBe(startLength + 1);
    expect(parseBoundedQueryNumber("5000", 1, 100)).toBe(100);
    expect(parseBoundedQueryNumber("-3", 1, 100)).toBe(1);
    expect(redactSecretConfig({ api_key: "secret", theme: "dark" })).toEqual({
      api_key: "***redacted***",
      theme: "dark",
    });
    expect(
      redactSecretConfig({
        token_optimization: { toonStructuredDataEnabled: true },
        access_token: "secret",
      })
    ).toEqual({
      token_optimization: { toonStructuredDataEnabled: true },
      access_token: "***redacted***",
    });
    expect(buildCorsHeaders("http://127.0.0.1:4269")).toMatchObject({
      "Access-Control-Allow-Origin": "http://127.0.0.1:4269",
    });
    expect(buildCorsHeaders("https://evil.example")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(securityHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(securityHeaders["Permissions-Policy"]).toBe(
      "camera=(), microphone=(self), geolocation=()"
    );
  });

  test("normalizes IDE and LSP payloads outside the route table", () => {
    expect(sanitizeInlineCompletion("<think>plan</think>```ts\nconst value = 1\n```", "")).toBe(
      "const value = 1"
    );
    expect(truncateInlineContext("abcdef", 3)).toBe("def");
    expect(
      normalizeDefinitionLocation({
        uri: "file:///Users/carsen/project/file.ts",
        range: { start: { line: 4, character: 2 } },
      })
    ).toEqual({
      uri: "file:///Users/carsen/project/file.ts",
      path: "/Users/carsen/project/file.ts",
      line: 4,
      character: 2,
    });
    expect(
      normalizeLspSymbol({
        name: "run",
        kind: 12,
        range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
      })
    ).toMatchObject({ name: "run", line: 2, character: 3, endLine: 4, endCharacter: 5 });
  });

  test("keeps durable screenshot metadata while removing persisted base64 payloads", () => {
    const result = sanitizeToolMediaResult(
      JSON.stringify({
        action: "capture",
        ok: true,
        screenshot: "a".repeat(10_000),
        screenshotMime: "image/png",
        filePath: "/Users/test/.cybara/screenshots/screen.png",
        viewport: { width: 1920, height: 1080 },
      })
    );

    expect(result).toEqual({
      action: "capture",
      ok: true,
      contentType: "image/png",
      screenshotMime: "image/png",
      filePath: "/Users/test/.cybara/screenshots/screen.png",
      viewport: { width: 1920, height: 1080 },
    });
    expect(result).not.toHaveProperty("screenshot");
    expect(
      extractScreenshotPathFromText(
        "Screenshot saved to `/Users/test/.cybara/screenshots/screen.png`"
      )
    ).toBe("/Users/test/.cybara/screenshots/screen.png");
    expect(
      extractScreenshotPathFromText("Saved C:\\Users\\test\\.cybara\\screenshots\\screen-2.png")
    ).toBe("C:\\Users\\test\\.cybara\\screenshots\\screen-2.png");
  });

  test("formats skill install specs without coupling routes to skill internals", () => {
    expect(formatSkillInstallSpec({ kind: "brew", formula: "ripgrep" })).toMatchObject({
      type: "brew",
      command: "brew install ripgrep",
    });
    expect(formatSkillInstallSpec({ kind: "node", package: "tsx" })).toMatchObject({
      type: "node",
      command: "bun add -g tsx",
    });
  });
});
