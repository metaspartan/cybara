import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("xterm theme is shared, not duplicated", () => {
  test("the palette lives in one factory module", () => {
    const theme = read("../../ui/src/pages/ide/xtermTheme.ts");
    expect(theme).toContain("export function buildXtermTheme");
    // A representative palette entry to confirm the palette moved here.
    expect(theme).toContain('brightWhite: "#fafafa"');
  });

  test("both terminals consume the shared factory instead of an inline palette", () => {
    const terminal = read("../../ui/src/pages/Terminal.tsx");
    const embedded = read("../../ui/src/components/ide/EmbeddedTerminalPanel.tsx");
    for (const src of [terminal, embedded]) {
      expect(src).toContain("buildXtermTheme(");
      // The full palette is no longer inlined in either file.
      expect(src).not.toContain('brightMagenta: "#c084fc"');
    }
    // Each keeps its own surface background.
    expect(terminal).toContain('buildXtermTheme("#0a0a0f")');
    expect(embedded).toContain('buildXtermTheme("#050508")');
  });
});
