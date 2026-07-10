import { describe, expect, test } from "bun:test";
import {
  parseAgentReasoningSetting,
  readAgentReasoningSetting,
  withAgentReasoningSetting,
} from "../../src/core/agent-reasoning";

describe("agent reasoning settings", () => {
  test("reads snake and camel case model parameters", () => {
    expect(readAgentReasoningSetting({ model_params: { reasoning_effort: "high" } })).toBe("high");
    expect(readAgentReasoningSetting({ modelParams: { reasoningEffort: "medium" } })).toBe(
      "medium"
    );
  });

  test("updates reasoning without discarding unrelated agent config", () => {
    const updated = withAgentReasoningSetting(
      { autostart: true, model_params: { temperature: 0.4, reasoning_effort: "low" } },
      "xhigh"
    );
    expect(updated).toEqual({
      autostart: true,
      model_params: { temperature: 0.4, reasoning_effort: "xhigh" },
    });
  });

  test("default removes only the agent override", () => {
    expect(
      withAgentReasoningSetting(
        { tools: ["read"], model_params: { reasoning_effort: "high" } },
        null
      )
    ).toEqual({ tools: ["read"] });
  });

  test("rejects unsupported effort values", () => {
    expect(parseAgentReasoningSetting("extreme")).toEqual({ valid: false, effort: null });
    expect(parseAgentReasoningSetting(4)).toEqual({ valid: false, effort: null });
    expect(parseAgentReasoningSetting("")).toEqual({ valid: true, effort: null });
  });
});
