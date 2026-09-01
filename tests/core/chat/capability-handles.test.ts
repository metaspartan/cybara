import { describe, expect, test } from "bun:test";
import { uniqueCapabilityHandles } from "../../../src/core/chat/capability-handles";

describe("unique capability handles", () => {
  test("keeps readable handles when names are already distinct", () => {
    const handles = uniqueCapabilityHandles([
      { id: "first-agent", name: "Launch Lead" },
      { id: "second-agent", name: "Risk Scout" },
    ]);
    expect(handles.get("first-agent")).toBe("launch-lead");
    expect(handles.get("second-agent")).toBe("risk-scout");
  });

  test("disambiguates legacy entities whose names normalize to the same handle", () => {
    const handles = uniqueCapabilityHandles([
      { id: "12345678-first", name: "Launch Lead" },
      { id: "87654321-second", name: "Launch  Lead!" },
    ]);
    expect(handles.get("12345678-first")).toBe("launch-lead-12345678");
    expect(handles.get("87654321-second")).toBe("launch-lead-87654321");
    expect(new Set(handles.values()).size).toBe(2);
  });

  test("creates a usable fallback for names without supported handle characters", () => {
    const handles = uniqueCapabilityHandles([{ id: "fallback-id", name: "你好" }]);
    expect(handles.get("fallback-id")).toBe("agent-fallback");
  });
});
