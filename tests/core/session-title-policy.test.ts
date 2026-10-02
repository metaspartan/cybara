import { describe, expect, test } from "bun:test";
import { shouldGenerateModelSessionTitle } from "../../src/core/session-title-policy";
import { deriveSessionTitleFromTurn } from "../../src/core/session-title";

describe("request-efficient session titles", () => {
  test("keeps useful titles locally without an implicit auxiliary model request", () => {
    expect(deriveSessionTitleFromTurn("Fix the file parser so escaped quotes survive")).toBe(
      "Fix the file parser so escaped quotes survive"
    );
    for (const value of [undefined, null, false, "true", 1, {}, []])
      expect(shouldGenerateModelSessionTitle(value)).toBe(false);
    expect(shouldGenerateModelSessionTitle(true)).toBe(true);
  });
});
