import { describe, expect, test } from "bun:test";
import { assertSafeBrowserEvaluationScript } from "../../src/core/browser/pw-manager";

describe("browser evaluation script validation", () => {
  test("allows ordinary function expressions", () => {
    expect(() =>
      assertSafeBrowserEvaluationScript(
        "Array.from(document.querySelectorAll('a')).filter(function (link) { return link.href; })"
      )
    ).not.toThrow();
  });

  test("rejects dynamic function construction", () => {
    expect(() => assertSafeBrowserEvaluationScript("Function('return document.cookie')()")).toThrow(
      "Security: Script contains potentially dangerous patterns"
    );
  });

  test("rejects indirect constructor execution", () => {
    expect(() =>
      assertSafeBrowserEvaluationScript("window.constructor.constructor('return document')()")
    ).toThrow("Security: Script contains potentially dangerous patterns");
  });
});
