import { describe, expect, test } from "bun:test";
import {
  hasProviderMessagePayload,
  normalizeProviderMessages,
} from "../../src/core/llm/provider-messages";

describe("provider message normalization", () => {
  test("drops empty assistant UI records without dropping model payloads", () => {
    const messages = [
      { role: "user", content: "start" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "", images: [{ data: "image" }] },
      { role: "assistant", content: "", tool_calls: [{ id: "call-1" }] },
      { role: "assistant", content: "done" },
      { role: "user", content: "" },
    ];

    expect(normalizeProviderMessages(messages)).toEqual([
      messages[0],
      messages[3],
      messages[4],
      messages[5],
      messages[6],
    ]);
  });

  test("recognizes structured content and paired tool messages", () => {
    expect(hasProviderMessagePayload({ role: "assistant", content: [] })).toBe(false);
    expect(
      hasProviderMessagePayload({ role: "assistant", content: [{ type: "text", text: "ok" }] })
    ).toBe(true);
    expect(hasProviderMessagePayload({ role: "tool", content: "", tool_call_id: "call-1" })).toBe(
      true
    );
  });
});
