import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_DIRS = ["src", "scripts", "ui/src", "tests"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx", ".json"]);

const HARD_CODED_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: "macOS workspace absolute path",
    regex: /\/Users\/[A-Za-z0-9._-]+\/clawd\/claw-agent-platform/,
  },
  {
    label: "Linux workspace absolute path",
    regex: /\/home\/[A-Za-z0-9._-]+\/clawd\/claw-agent-platform/,
  },
  {
    label: "Windows workspace absolute path",
    regex: /[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+\\\\clawd\\\\claw-agent-platform/,
  },
  { label: "hardcoded workspace fragment", regex: /clawd\/claw-agent-platform/ },
];

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx) : "";
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
      collectFiles(fullPath, out);
      continue;
    }

    if (TEXT_EXTENSIONS.has(extensionOf(fullPath))) {
      out.push(fullPath);
    }
  }
}

describe("Path hardcoding guard", () => {
  test("source does not include absolute user/workspace paths", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      collectFiles(join(ROOT_DIR, dir), files);
    }

    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith("no-hardcoded-paths.test.ts")) continue;
      const content = readFileSync(file, "utf8");
      for (const pattern of HARD_CODED_PATTERNS) {
        if (pattern.regex.test(content)) {
          violations.push(`${file}: ${pattern.label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
