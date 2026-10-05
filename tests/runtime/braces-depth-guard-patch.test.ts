import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasVerifiedBracesDepthGuardPatch } from "../../scripts/security-audit";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const MAX_DEPTH = 100;

const nestedPattern = (depth: number) => "{".repeat(depth) + "a" + "}".repeat(depth);

function runProbe(body: string): unknown {
  const result = Bun.spawnSync([process.execPath, "--eval", body], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

const probeSource = String.raw`
import * as bracesModule from "braces";
const expand = bracesModule.braces ?? bracesModule.default;
const nested = depth => "{".repeat(depth) + "a" + "}".repeat(depth);
const attack = depth => {
  try { expand(nested(depth)); return "accepted"; }
  catch (error) { return error.name; }
};
const legit = pattern => {
  try { return { ok: true, value: expand(pattern) }; }
  catch (error) { return { ok: false, name: error.name }; }
};
console.log(JSON.stringify({
  attack: [4000, 4900].map(attack),
  boundary: [99, 100, 101].map(attack),
  legit: ["{a,b}", "a/{b,c}/d", "src/**/*.{ts,tsx}", "{a,{b,{c,d}}}", "{1..10}", "{{a,b},c}"].map(legit),
}));
`;

describe("braces nesting-depth guard", () => {
  test("rejects the advisory crash input while preserving legitimate expansion", () => {
    const result = runProbe(probeSource) as {
      attack: string[];
      boundary: string[];
      legit: { ok: boolean; value?: string[]; name?: string }[];
    };

    for (const depth of [4000, 4900]) {
      expect(result.attack[depth === 4000 ? 0 : 1]).toBe("SyntaxError");
    }

    expect(result.boundary).toEqual(["accepted", "accepted", "SyntaxError"]);

    expect(result.legit.map((entry) => entry.ok)).toEqual([true, true, true, true, true, true]);
    expect(result.legit.map((entry) => entry.value)).toEqual([
      ["(a|b)"],
      ["a/(b|c)/d"],
      ["src/**/*.(ts|tsx)"],
      ["(a|(b|(c|d)))"],
      ["([1-9]|10)"],
      ["((a|b)|c)"],
    ]);
  });

  test("patch is registered and applied in every workspace that resolves braces", async () => {
    const workspaces = [
      join(REPO_ROOT, "package.json"),
      join(REPO_ROOT, "apps", "mobile", "package.json"),
    ];
    for (const manifestPath of workspaces) {
      const cwd = join(manifestPath, "..");
      const manifest = Bun.file(manifestPath);
      expect(await manifest.exists()).toBe(true);
      const patched = (await manifest.json()) as {
        patchedDependencies?: Record<string, string>;
      };
      expect(patched.patchedDependencies?.["braces@3.0.3"]).toBe("patches/braces@3.0.3.patch");
      expect(hasVerifiedBracesDepthGuardPatch(cwd)).toBe(true);
    }
  });

  test("audit withholds the exception when the guard is absent or weakened", () => {
    const temp = mkdtempSync(join(tmpdir(), "cybara-braces-guard-"));
    try {
      const manifestPath = join(temp, "package.json");
      const parsePath = join(temp, "node_modules", "braces", "lib", "parse.js");
      mkdirSync(join(temp, "node_modules", "braces", "lib"), { recursive: true });
      writeFileSync(
        manifestPath,
        JSON.stringify({ patchedDependencies: { "braces@3.0.3": "patches/braces@3.0.3.patch" } })
      );
      writeFileSync(
        parsePath,
        `const MAX_DEPTH = ${MAX_DEPTH};\nif (depth > MAX_DEPTH) {\n  throw new SyntaxError(\`Input nesting depth (\${depth}), exceeds max depth (\${MAX_DEPTH})\`);\n}\n`
      );
      expect(hasVerifiedBracesDepthGuardPatch(temp)).toBe(true);

      writeFileSync(parsePath, "const MAX_DEPTH = 1000000;\n");
      expect(hasVerifiedBracesDepthGuardPatch(temp)).toBe(false);

      writeFileSync(
        manifestPath,
        JSON.stringify({ patchedDependencies: { "braces@3.0.3": "patches/other.patch" } })
      );
      expect(hasVerifiedBracesDepthGuardPatch(temp)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("attack pattern stays under the documented character cap", () => {
    expect(nestedPattern(4900).length).toBeLessThan(10_000);
  });
});
