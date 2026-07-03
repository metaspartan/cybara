import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ideSourcePath = fileURLToPath(new URL("../../ui/src/pages/IDE.tsx", import.meta.url));
const ideTypesSourcePath = fileURLToPath(
  new URL("../../ui/src/pages/ide/ideTypes.ts", import.meta.url)
);

function readIdeSource(): string {
  return readFileSync(ideSourcePath, "utf8");
}

function readIdeTypesSource(): string {
  return readFileSync(ideTypesSourcePath, "utf8");
}

describe("IDE top menu layout", () => {
  test("uses multiple top-level menus instead of a single file-only dropdown", () => {
    const source = readIdeSource();
    const typesSource = readIdeTypesSource();

    expect(typesSource).toContain(
      'export type IdeTopMenuId = "file" | "edit" | "view" | "terminal" | "go";'
    );
    expect(source).toContain(
      "const [openMenu, setOpenMenu] = useState<IdeTopMenuId | null>(null);"
    );
    expect(source).toContain('label: "File"');
    expect(source).toContain('label: "Edit"');
    expect(source).toContain('label: "View"');
    expect(source).toContain('label: "Terminal"');
    expect(source).toContain('label: "Go"');
    expect(source).toContain("{topMenus.map((menu) => (");
    expect(source).not.toContain('useState<"file" | null>(null)');
  });
});
