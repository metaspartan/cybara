import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldRecoverPreloadError } from "../../ui/src/lib/preloadRecovery";

describe("frontend preload recovery", () => {
  test("reloads once for a stale route chunk without creating a reload loop", () => {
    expect(shouldRecoverPreloadError(Number.NaN, 100_000)).toBe(true);
    expect(shouldRecoverPreloadError(90_000, 100_000)).toBe(false);
    expect(shouldRecoverPreloadError(70_000, 100_000)).toBe(true);
  });

  test("installs recovery before rendering the application", () => {
    const source = readFileSync(join(import.meta.dir, "../../ui/src/main.tsx"), "utf8");
    expect(source.indexOf("installPreloadRecovery();")).toBeLessThan(
      source.indexOf('createRoot(document.getElementById("root")!)')
    );
  });
});
