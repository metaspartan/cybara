import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_FILES = ["package.json", "ui/package.json", "apps/mobile/package.json"] as const;
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
] as const;
const EXACT_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const EXACT_NPM_ALIAS =
  /^npm:(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT_DIR, rel), "utf8")) as Record<string, unknown>;
}

function isPinnedSpec(spec: string): boolean {
  return (
    EXACT_SEMVER.test(spec) ||
    EXACT_NPM_ALIAS.test(spec) ||
    spec === "workspace:*" ||
    spec.startsWith("file:") ||
    spec.startsWith("link:")
  );
}

describe("JavaScript dependency pin policy", () => {
  test("direct package manifests use exact versions for registry dependencies", () => {
    const violations: string[] = [];

    for (const file of PACKAGE_FILES) {
      const pkg = readJson(file);
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = pkg[section];
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;

        for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
          if (typeof spec !== "string" || isPinnedSpec(spec)) continue;
          violations.push(`${file} ${section}.${name}=${spec}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
