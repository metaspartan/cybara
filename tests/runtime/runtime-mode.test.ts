import { describe, expect, test } from "bun:test";
import { isCompiledRuntime, isProductionRuntime } from "../../src/core/runtime/runtime-mode";

describe("runtime mode", () => {
  test("recognizes Bun source runtimes across platforms", () => {
    expect(isCompiledRuntime("/Users/test/.bun/bin/bun")).toBe(false);
    expect(isCompiledRuntime("C:\\Users\\test\\.bun\\bin\\bun.exe")).toBe(false);
  });

  test("recognizes installed standalone executables", () => {
    expect(isCompiledRuntime("/users/ck/.local/bin/cybara")).toBe(true);
    expect(isCompiledRuntime("C:\\Program Files\\Cybara\\cybara.exe")).toBe(true);
  });

  test("treats compiled and explicitly production runtimes as production", () => {
    expect(isProductionRuntime({ execPath: "/users/ck/.local/bin/cybara", nodeEnv: "" })).toBe(
      true
    );
    expect(isProductionRuntime({ execPath: "/usr/local/bin/bun", nodeEnv: "production" })).toBe(
      true
    );
    expect(isProductionRuntime({ execPath: "/usr/local/bin/bun", nodeEnv: "development" })).toBe(
      false
    );
  });
});
