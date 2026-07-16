import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const updateSettings = readFileSync(
  join(root, "ui", "src", "pages", "settings", "DesktopUpdateSettings.tsx"),
  "utf8"
);
const routes = readFileSync(join(root, "src", "api", "routes.ts"), "utf8");
const buildScript = readFileSync(join(root, "scripts", "build-sidecar.ts"), "utf8");

describe("desktop update settings", () => {
  test("shows release provenance from the gateway build contract", () => {
    expect(updateSettings).toContain("systemApi.buildInfo()");
    expect(updateSettings).toContain('label="Release commit"');
    expect(updateSettings).toContain('label="SHA-256"');
    expect(updateSettings).toContain('label="Executable"');
    expect(routes).toContain('"GET /api/build-info"');
    expect(routes).toContain("getBuildProvenance()");
  });

  test("stamps release sidecars with the source commit", () => {
    expect(buildScript).toContain("process.env.CYBARA_BUILD_COMMIT = buildCommit");
    expect(buildScript).toContain("--env=CYBARA_BUILD_*");
  });
});
