import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readIdeUiSource } from "../source-fixtures";
import { readNativePlatformSource } from "../shared/source-bundles";

const ideSource = readIdeUiSource();
const ideTypesSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/ide/ideTypes.ts", import.meta.url)),
  "utf8"
);
const nativeIdeSource = readNativePlatformSource();

describe("IDE bounded-search UI wiring", () => {
  test("web IDE surfaces filesystem scan limits without treating them as hard errors", () => {
    expect(ideTypesSource).toContain("filesScanned?: number");
    expect(ideTypesSource).toContain("scanTruncated?: boolean");
    expect(ideSource).toContain("formatIdeScannedFiles");
    expect(ideSource).toContain("Filesystem scan limited");
    expect(ideSource).toContain("Scan limited");
    expect(ideSource).toContain("quickOpenNotice");
  });

  test("native macOS IDE decodes and displays bounded-search metadata", () => {
    expect(nativeIdeSource).toContain("let filesScanned: Int?");
    expect(nativeIdeSource).toContain("let scanTruncated: Bool?");
    expect(nativeIdeSource).toContain("Trusted local workspace");
    expect(nativeIdeSource).toContain("nativeIDEScanLimitText");
    expect(nativeIdeSource).toContain("Filesystem scan limited");
  });

  test("native macOS IDE uses a compact editor-first split with a segmented inspector", () => {
    expect(nativeIdeSource).toContain('@State private var inspectorSection = "search"');
    expect(nativeIdeSource).toContain('Picker("IDE inspector", selection: $inspectorSection)');
    expect(nativeIdeSource).toContain('Text("Search").tag("search")');
    expect(nativeIdeSource).toContain('Text("Results").tag("results")');
    expect(nativeIdeSource).toContain('Text("Index").tag("index")');
    expect(nativeIdeSource).toContain(".pickerStyle(.segmented)");
    expect(nativeIdeSource).toContain(".frame(width: 286)");
    expect(nativeIdeSource).toContain('.frame(width: inspectorSection == "chat" ? 460 : 318)');
    expect(nativeIdeSource).toContain(".padding(.horizontal, 18)");
  });
});
