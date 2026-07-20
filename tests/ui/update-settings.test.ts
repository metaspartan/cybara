import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readNativeSettingsSource } from "../shared/source-bundles";

const root = join(import.meta.dir, "..", "..");
const updateSettings = readFileSync(
  join(root, "ui", "src", "pages", "settings", "DesktopUpdateSettings.tsx"),
  "utf8"
);
const routes = readFileSync(join(root, "src", "api", "routes.ts"), "utf8");
const buildScript = readFileSync(join(root, "scripts", "build-sidecar.ts"), "utf8");
const packageScript = readFileSync(join(root, "scripts", "package.ts"), "utf8");
const standaloneBuildScript = readFileSync(
  join(root, "scripts", "build-standalone-cli.ts"),
  "utf8"
);
const releaseWorkflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
const nativeSettings = readNativeSettingsSource();

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
    expect(buildScript).toContain("buildStandaloneCli");
    expect(buildScript).toContain('entryModule: "src/index.ts"');
    expect(packageScript).toContain("process.env.CYBARA_BUILD_COMMIT = buildCommit");
    expect(packageScript).toContain("buildStandaloneCli");
    expect(standaloneBuildScript).toContain('"--env=CYBARA_BUILD_*"');
    expect(releaseWorkflow).toContain("scripts/build-standalone-cli.ts");
    expect(buildScript).not.toContain("--compile --env=CYBARA_BUILD_*");
    expect(standaloneBuildScript).not.toContain("--compile --env=CYBARA_BUILD_*");
  });

  test("keeps native macOS update settings in parity", () => {
    expect(nativeSettings).toContain("case updates");
    expect(nativeSettings).toContain("case .updates: updatesTab");
    expect(nativeSettings).toContain('nativeBuildValue("Release commit", buildInfo?.commit)');
    expect(nativeSettings).toContain('nativeBuildValue("SHA-256", buildInfo?.executable_sha256)');
  });
});
