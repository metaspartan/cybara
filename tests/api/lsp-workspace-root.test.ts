import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, parse } from "path";
import { resolveWorkspacePath } from "../../src/api/routes/lsp-ide";

describe("LSP workspace root resolution", () => {
  test("keeps nested files in one project manager", () => {
    const root = mkdtempSync(join(homedir(), ".cybara-lsp-root-"));
    try {
      const nested = join(root, "src", "features");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}");
      const file = join(nested, "index.ts");
      writeFileSync(file, "export {}\n");

      expect(resolveWorkspacePath(file)).toBe(realpathSync(root));
      expect(resolveWorkspacePath(join(root, "config.yaml"))).toBe(realpathSync(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves explicit directory roots", () => {
    const root = mkdtempSync(join(homedir(), ".cybara-lsp-directory-"));
    try {
      expect(resolveWorkspacePath(root)).toBe(realpathSync(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts paths outside the home directory", () => {
    const root = parse(homedir()).root;
    expect(resolveWorkspacePath(root)).toBe(root);
  });
});
