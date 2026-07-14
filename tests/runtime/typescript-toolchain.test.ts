import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

interface PackageManifest {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TypeScriptConfig {
  compilerOptions?: Record<string, unknown>;
}

const root = join(import.meta.dir, "../..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

describe("TypeScript toolchain", () => {
  test("uses native TypeScript 7 for every compiled application", () => {
    const expectedCompiler = "npm:typescript@7.0.2";
    const expectedApi = "6.0.3";
    const packages = [
      "package.json",
      "ui/package.json",
      "apps/mobile/package.json",
      "site/package.json",
    ];

    for (const path of packages) {
      const manifest = readJson<PackageManifest>(path);
      expect(manifest.devDependencies?.["@typescript/native"]).toBe(expectedCompiler);
      expect(manifest.devDependencies?.typescript).toBe(expectedApi);
      expect(manifest.scripts?.typecheck).toContain("@typescript/native/bin/tsc");
    }
  });

  test("keeps compiler API tooling on supported TypeScript 6", () => {
    const rootPackage = readJson<PackageManifest>("package.json");
    const uiPackage = readJson<PackageManifest>("ui/package.json");

    expect(rootPackage.devDependencies?.["@typescript-eslint/eslint-plugin"]).toBe("8.64.0");
    expect(rootPackage.devDependencies?.["@typescript-eslint/parser"]).toBe("8.64.0");
    expect(uiPackage.devDependencies?.["typescript-eslint"]).toBe("8.64.0");
  });

  test("uses TypeScript 7 compatible path and Bun type configuration", () => {
    const rootConfig = readJson<TypeScriptConfig>("tsconfig.json");
    const uiConfig = readJson<TypeScriptConfig>("ui/tsconfig.json");
    const uiAppConfig = readFileSync(join(root, "ui/tsconfig.app.json"), "utf8");

    expect(rootConfig.compilerOptions?.baseUrl).toBeUndefined();
    expect(rootConfig.compilerOptions?.ignoreDeprecations).toBeUndefined();
    expect(rootConfig.compilerOptions?.types).toEqual(["bun"]);
    expect(uiConfig.compilerOptions?.baseUrl).toBeUndefined();
    expect(uiConfig.compilerOptions?.ignoreDeprecations).toBeUndefined();
    expect(uiAppConfig).not.toContain('"baseUrl"');
  });
});
