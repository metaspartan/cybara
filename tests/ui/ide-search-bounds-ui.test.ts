import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ideSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/IDE.tsx", import.meta.url)),
  "utf8"
);
const ideTypesSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/ide/ideTypes.ts", import.meta.url)),
  "utf8"
);
const nativeIdeSource = readFileSync(
  fileURLToPath(
    new URL("../../apps/macos/Cybara/Sources/Cybara/NativePlatformScreens.swift", import.meta.url)
  ),
  "utf8"
);

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
});
