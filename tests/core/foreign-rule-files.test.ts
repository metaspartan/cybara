import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { getBootstrapContextFiles, readForeignRuleFiles } from "../../src/core/bootstrap-files";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cybara-rules-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

describe("rules written for other coding tools", () => {
  test("loads always-applied rules and skips conditional ones", () => {
    const root = project({
      ".cursorrules": "Use tabs.",
      ".github/copilot-instructions.md": "Prefer pnpm.",
      "GEMINI.md": "Run make test.",
      ".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nNever edit generated files.",
      ".cursor/rules/scoped.mdc": "---\nglobs: src/**/*.ts\nalwaysApply: false\n---\nTS only.",
      ".cursor/rules/plain.md": "Keep functions small.",
      ".clinerules/style.md": "Name things clearly.",
    });
    const rules = readForeignRuleFiles(root);
    expect(rules.map((rule) => rule.name)).toEqual([
      "GEMINI.md",
      ".github/copilot-instructions.md",
      ".cursorrules",
      ".cursor/rules/always.mdc",
      ".cursor/rules/plain.md",
      ".clinerules/style.md",
    ]);
    expect(rules.find((rule) => rule.name.endsWith("always.mdc"))?.content).toBe(
      "Never edit generated files."
    );
  });

  test("are context only when the project has no AGENTS.md or CLAUDE.md", () => {
    const withoutOwn = project({ ".cursorrules": "Use tabs." });
    expect(getBootstrapContextFiles(withoutOwn).map((file) => file.name)).toEqual([".cursorrules"]);
    const withOwn = project({ ".cursorrules": "Use tabs.", "AGENTS.md": "Use spaces." });
    expect(getBootstrapContextFiles(withOwn).map((file) => file.name)).toEqual(["AGENTS.md"]);
  });
});
