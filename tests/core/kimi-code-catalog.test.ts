import { describe, expect, test } from "bun:test";
import { providers } from "../../src/core/providers";
import { kimiCodeModels } from "../../src/core/providers/kimi-code";
import {
  coerceReasoningEffort,
  supportedReasoningEfforts,
} from "../../shared/reasoning-capabilities";

const liveModels: ReadonlyArray<[string, number, boolean]> = [
  ["kimi-for-coding", 1_048_576, true],
  ["kimi-for-coding-highspeed", 262_144, true],
  ["k3", 1_048_576, true],
  ["k3-256k", 262_144, true],
  ["k3.1-pro", 1_048_576, true],
  ["k3.1-pro-highspeed", 1_048_576, true],
];

describe("Kimi Code catalog matches the live models endpoint", () => {
  for (const [id, context, image] of liveModels) {
    test(`${id} reports ${context} context and image input`, () => {
      const model = kimiCodeModels.find((entry) => entry.id === id);
      expect(model, id).toBeDefined();
      expect(model?.context).toBe(context);
      expect((model?.input as readonly string[]).includes("image")).toBe(image);
    });
  }

  test("both Kimi Code providers share one model list", () => {
    expect(providers["kimi-code"].models.map((model) => model.id)).toEqual(
      providers["kimi-code-oauth"].models.map((model) => model.id)
    );
  });

  test("labels the flagship alias with its current name", () => {
    expect(kimiCodeModels.find((entry) => entry.id === "kimi-for-coding")?.name).toBe(
      "Kimi K2.8 Preview"
    );
  });
});

describe("Kimi Code reasoning efforts", () => {
  test("K3.1 and the flagship alias expose low, high and max", () => {
    for (const model of ["k3", "k3-256k", "k3.1-pro", "k3.1-pro-highspeed", "kimi-for-coding"]) {
      expect(supportedReasoningEfforts("kimi-code-oauth", model), model).toEqual([
        "low",
        "high",
        "max",
      ]);
    }
    expect(coerceReasoningEffort("medium", "kimi-code-oauth", "k3.1-pro")).toBe("high");
  });

  test("the K2.7 highspeed model keeps the generic effort list", () => {
    expect(supportedReasoningEfforts("kimi-code-oauth", "kimi-for-coding-highspeed")).not.toEqual([
      "low",
      "high",
      "max",
    ]);
  });
});
