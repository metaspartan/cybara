import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const idePath = join(process.cwd(), "ui", "src", "pages", "IDE.tsx");
const modalPath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "ide",
  "AdvancedIndexerSettingsModal.tsx"
);

describe("advanced IDE indexer settings", () => {
  test("keeps the advanced modal in a dedicated controlled component", () => {
    const ideSource = readFileSync(idePath, "utf8");
    const modalSource = readFileSync(modalPath, "utf8");

    expect(ideSource).toContain("<AdvancedIndexerSettingsModal");
    expect(ideSource).toContain("onChangeSettings={(settings) =>");
    expect(modalSource).toContain("export function AdvancedIndexerSettingsModal(");
    expect(modalSource).toContain("onReindex");
    expect(modalSource).toContain("onStop");
    expect(modalSource).toContain("onSave");
  });
});
