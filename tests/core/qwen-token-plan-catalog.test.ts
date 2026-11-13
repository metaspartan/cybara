import { describe, expect, test } from "bun:test";
import { QWEN_TOKEN_PLAN_MODELS } from "../../src/core/providers/catalog-qwen";
import { providers } from "../../src/core/providers";
import { resolveModelAlias } from "../../src/core/system-prompt";

describe("qwen token plan catalog", () => {
  test("includes qwen4-max-preview as the flagship model", () => {
    const model = QWEN_TOKEN_PLAN_MODELS.find((m) => m.id === "qwen4-max-preview");
    expect(model).toBeDefined();
    expect(model?.reasoning).toBe(true);
    expect(model?.input).toContain("image");
  });

  test("keeps qwen3.8 and qwen3.7 models listed", () => {
    const ids = QWEN_TOKEN_PLAN_MODELS.map((m) => m.id);
    expect(ids).toContain("qwen3.8-flash");
    expect(ids).toContain("qwen3.8-max");
    expect(ids).toContain("qwen3.7-plus");
  });

  test("both qwen-token-plan providers expose the same catalog", () => {
    for (const provider of ["qwen-token-plan", "qwen-token-plan-cn"] as const) {
      expect(providers[provider].models.map((m) => m.id)).toContain("qwen4-max-preview");
    }
  });

  test("resolves the qwen4-max alias to the preview id per provider", () => {
    expect(resolveModelAlias("qwen4-max", "qwen-token-plan")).toBe("qwen4-max-preview");
    expect(resolveModelAlias("qwen4-max", "qwen-token-plan-cn")).toBe("qwen4-max-preview");
    expect(resolveModelAlias("qwen4-max-preview", "qwen-token-plan")).toBe("qwen4-max-preview");
  });
});
