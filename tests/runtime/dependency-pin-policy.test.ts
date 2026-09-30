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
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
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

  test("web, mobile, and site lockfiles resolve the patched Nano ID release", () => {
    for (const directory of ["ui", "apps/mobile", "site"] as const) {
      const pkg = readJson(`${directory}/package.json`);
      const overrides = pkg.overrides as Record<string, unknown>;
      const lockfile = readFileSync(join(ROOT_DIR, directory, "bun.lock"), "utf8");

      expect(overrides.nanoid).toBe("3.3.18");
      expect(lockfile).toContain('"nanoid": ["nanoid@3.3.18"');
      expect(lockfile).not.toContain('"nanoid": ["nanoid@3.3.17"');
    }
  });

  test("lockfiles resolve the patched brace-expansion and ip-address releases", () => {
    const expected: Array<{ directory: string; braceExpansion: string; vulnerable: string[] }> = [
      { directory: "", braceExpansion: "1.1.21", vulnerable: ["1.1.18", "5.0.9"] },
      { directory: "ui/", braceExpansion: "5.0.12", vulnerable: ["5.0.9"] },
      { directory: "apps/mobile/", braceExpansion: "5.0.12", vulnerable: ["5.0.9"] },
    ];

    for (const entry of expected) {
      const overrides = readJson(`${entry.directory}package.json`).overrides as Record<
        string,
        unknown
      >;
      const lockfile = readFileSync(join(ROOT_DIR, entry.directory, "bun.lock"), "utf8");

      expect(overrides["brace-expansion"]).toBe(entry.braceExpansion);
      expect(lockfile).toContain(`"brace-expansion": ["brace-expansion@${entry.braceExpansion}"`);
      for (const vulnerable of entry.vulnerable) {
        expect(lockfile).not.toContain(`"brace-expansion": ["brace-expansion@${vulnerable}"`);
      }
    }

    const rootOverrides = readJson("package.json").overrides as Record<string, unknown>;
    const rootLockfile = readFileSync(join(ROOT_DIR, "bun.lock"), "utf8");
    expect(rootOverrides["ip-address"]).toBe("10.7.1");
    expect(rootLockfile).toContain('"ip-address": ["ip-address@10.7.1"');
    expect(rootLockfile).not.toContain('"ip-address": ["ip-address@10.5.1"');
  });

  test("root, web, and mobile lockfiles resolve the patched Browserslist release", () => {
    for (const directory of ["", "ui/", "apps/mobile/"] as const) {
      const pkg = readJson(`${directory}package.json`);
      const overrides = pkg.overrides as Record<string, unknown>;
      const lockfile = readFileSync(join(ROOT_DIR, directory, "bun.lock"), "utf8");

      expect(overrides.browserslist).toBe("4.28.7");
      expect(lockfile).toContain('"browserslist": ["browserslist@4.28.7"');
      expect(lockfile).not.toMatch(/"browserslist": \["browserslist@4\.28\.[0-6]"/);
    }
  });
});
