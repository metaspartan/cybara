import { expect, test } from "bun:test";
import { readAgentExecutionMode, setAgentExecutionMode } from "../../ui/src/lib/agentExecutionMode";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("execution mode persists opt-in and direct mode removes it without overwriting other agent settings", () => {
  const previous = {
    memory_enabled: false,
    model_params: { reasoning_effort: "high" },
    tool_policy: { deny: ["write"] },
  };
  const fused = setAgentExecutionMode(previous, "fused");
  expect(readAgentExecutionMode(fused)).toBe("fused");
  expect(fused).toEqual({ ...previous, tool_execution_mode: "fused" });
  expect(setAgentExecutionMode(fused, "direct")).toEqual(previous);
  expect(readAgentExecutionMode({ tool_execution_mode: "untrusted" })).toBe("direct");
});

test("agent settings surface the host-execution boundary and preserve opt-in default", () => {
  const source = readFileSync(join(import.meta.dir, "../../ui/src/pages/Agents.tsx"), "utf8");
  expect(source).toContain('name="tool_execution_mode"');
  expect(source).toContain('value: "direct", label: "Direct tools (default)"');
  expect(source).toContain("not a security sandbox");
  expect(source).toContain("permissions and approvals still apply");
});
