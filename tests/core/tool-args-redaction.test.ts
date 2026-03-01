import { describe, expect, test } from "bun:test";
import { createToolArgsPreviewForLog } from "../../src/core/tools/handlers/index";

describe("tool argument redaction", () => {
  test("redacts sensitive keys and bearer tokens", () => {
    const preview = createToolArgsPreviewForLog({
      api_key: "sk-secret-value",
      nested: {
        password: "hunter2",
        Authorization: "Bearer abcdefghijk",
      },
      harmless: "ok",
    });

    expect(preview).toContain('"api_key":"[REDACTED]"');
    expect(preview).toContain('"password":"[REDACTED]"');
    expect(preview).toContain('"Authorization":"[REDACTED]"');
    expect(preview).toContain('"harmless":"ok"');
    expect(preview).not.toContain("sk-secret-value");
    expect(preview).not.toContain("hunter2");
    expect(preview).not.toContain("abcdefghijk");
  });

  test("truncates oversized preview payloads and includes checksum hint", () => {
    const longValue = "x".repeat(4000);
    const preview = createToolArgsPreviewForLog({ command: `echo ${longValue}` });

    expect(preview.length).toBeLessThan(2100);
    expect(preview).toContain("[truncated sha256:");
  });
});
