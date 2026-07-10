import { afterAll, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";

const original = config.getDefaultReasoningEffort();

afterAll(() => {
  config.setDefaultReasoningEffort(original);
});

describe("default reasoning effort config", () => {
  test("stores and normalizes valid levels", () => {
    expect(config.setDefaultReasoningEffort("high")).toBe("high");
    expect(config.getDefaultReasoningEffort()).toBe("high");
    expect(config.setDefaultReasoningEffort("MAX")).toBe("max");
    expect(config.getDefaultReasoningEffort()).toBe("max");
  });

  test("invalid or clearing values resolve to empty string", () => {
    expect(config.setDefaultReasoningEffort("garbage")).toBe("");
    expect(config.getDefaultReasoningEffort()).toBe("");
    expect(config.setDefaultReasoningEffort("off")).toBe("");
    expect(config.setDefaultReasoningEffort("")).toBe("");
  });
});
