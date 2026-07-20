import { describe, expect, test } from "bun:test";
import { resolveChatReasoningOptions } from "../../ui/src/pages/chat/chatReasoningOptions";

describe("chat reasoning options", () => {
  test("falls back to provider capabilities when gateway efforts are empty", () => {
    expect(resolveChatReasoningOptions("openai-codex", "gpt-5.6-sol", "effort", [])).toEqual([
      { value: null, label: "Default" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra High" },
      { value: "max", label: "Max" },
    ]);
  });

  test("prefers explicit gateway modes and nonempty efforts", () => {
    expect(resolveChatReasoningOptions("custom", "custom", "adaptive", [])).toEqual([
      { value: null, label: "Adaptive" },
    ]);
    expect(resolveChatReasoningOptions("custom", "custom", "effort", ["low", "max"])).toEqual([
      { value: null, label: "Default" },
      { value: "low", label: "Low" },
      { value: "max", label: "Max" },
    ]);
  });
});
