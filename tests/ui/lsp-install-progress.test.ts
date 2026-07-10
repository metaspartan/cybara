import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

describe("LSP install progress", () => {
  test("keeps progress visible until refreshed status confirms the operation", () => {
    const source = readFileSync(join(root, "ui", "src", "pages", "LSP.tsx"), "utf8");
    const hooks = readFileSync(join(root, "ui", "src", "hooks", "useApi.ts"), "utf8");

    expect(source).toContain('isInstalling ? "Downloading and configuring"');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('<LoaderCircle className="w-3 h-3 animate-spin" />');
    expect(
      hooks.match(/onSuccess: \(\) => queryClient\.invalidateQueries\(\{ queryKey: \["lsp"\] \}\)/g)
    ).toHaveLength(2);
  });
});
