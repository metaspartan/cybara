import { describe, expect, test } from "bun:test";
import { resetShellHooksForTests } from "../../src/core/shell-hooks";

describe("shell hooks", () => {
  test("resetShellHooksForTests does not throw", () => {
    expect(() => resetShellHooksForTests()).not.toThrow();
  });

  test("resetShellHooksForTests is idempotent", () => {
    resetShellHooksForTests();
    resetShellHooksForTests();
    expect(true).toBe(true);
  });
});
