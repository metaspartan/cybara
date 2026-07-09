import { describe, expect, test } from "bun:test";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

describe("mobile Metro monorepo config", () => {
  test("Expo export can resolve shared workspace modules in CI", () => {
    const projectRoot = resolve(ROOT_DIR, "apps/mobile");
    const workspaceRoot = ROOT_DIR;
    const config = require(resolve(projectRoot, "metro.config.js")) as {
      watchFolders?: string[];
      resolver?: {
        nodeModulesPaths?: string[];
        unstable_enableSymlinks?: boolean;
      };
    };

    expect(config.watchFolders).toContain(workspaceRoot);
    expect(config.watchFolders).toContain(resolve(workspaceRoot, "shared"));
    expect(config.resolver?.nodeModulesPaths).toContain(resolve(projectRoot, "node_modules"));
    expect(config.resolver?.nodeModulesPaths).toContain(resolve(workspaceRoot, "node_modules"));
    expect(config.resolver?.unstable_enableSymlinks).toBe(true);
  });

  test("mobile i18n imports the repo-level shared catalog", () => {
    const source = readFileSync(resolve(ROOT_DIR, "apps/mobile/src/i18n.tsx"), "utf8");
    const tsconfig = JSON.parse(
      readFileSync(resolve(ROOT_DIR, "apps/mobile/tsconfig.json"), "utf8")
    );

    expect(source).toContain('from "cybara-shared/i18n/catalog"');
    expect(tsconfig.compilerOptions.paths["cybara-shared/*"]).toEqual(["../../shared/*"]);
    expect(JSON.parse(readFileSync(resolve(ROOT_DIR, "shared/package.json"), "utf8")).name).toBe(
      "cybara-shared"
    );
    expect(source).not.toContain('from "../../../shared/i18n/catalog"');
    expect(source).not.toContain('from "../../../../shared/i18n/catalog"');
  });
});
