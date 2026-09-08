import { describe, expect, test } from "bun:test";
import {
  isOpenCodeProvider,
  openCodeSessionHeaders,
} from "../../src/core/providers/opencode-session";

describe("OpenCode session routing headers", () => {
  test("recognises every OpenCode provider alias and the opencode.ai host", () => {
    for (const type of [
      "opencode-go",
      "OpenCode-Go",
      "opencode-go-zen",
      "opencode_zen",
      "opencode",
    ]) {
      expect(isOpenCodeProvider(type)).toBe(true);
    }
    expect(isOpenCodeProvider("custom", "https://opencode.ai/zen/go/v1")).toBe(true);
    expect(isOpenCodeProvider("custom", "https://api.opencode.ai/v1")).toBe(true);
    expect(isOpenCodeProvider("custom", "https://api.openai.com/v1")).toBe(false);
    expect(isOpenCodeProvider("custom", "not a url")).toBe(false);
    expect(isOpenCodeProvider("anthropic")).toBe(false);
    expect(isOpenCodeProvider(undefined)).toBe(false);
  });

  test("pins the conversation id and identifies the client only for OpenCode", () => {
    expect(openCodeSessionHeaders("opencode-go", undefined, "session-1")).toEqual({
      "x-opencode-session": "session-1",
      "x-opencode-client": "cybara",
    });
    expect(openCodeSessionHeaders("openai", "https://api.openai.com/v1", "session-1")).toEqual({});
  });

  test("falls back to a fresh UUID when a call has no conversation", () => {
    const first = openCodeSessionHeaders("opencode_zen", undefined, undefined);
    const second = openCodeSessionHeaders("opencode_zen", undefined, "   ");
    expect(first["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(second["x-opencode-session"]).not.toBe(first["x-opencode-session"]);
  });
});
