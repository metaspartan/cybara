import { describe, expect, test } from "bun:test";

describe("source LOC gate", () => {
  test("covers every maintained source surface and language", async () => {
    const packageJson = await Bun.file("package.json").json();
    const script = await Bun.file("scripts/check-source-max-loc.ts").text();

    expect(packageJson.scripts["check:loc"]).toBe(
      "bun run scripts/check-source-max-loc.ts --max 2000"
    );
    for (const root of ["src", "ui/src", "tests", "apps", "shared", "scripts", "site/src"]) {
      expect(script).toContain(root);
    }
    for (const extension of ["css", "java", "kt", "kts", "py", "rs", "swift", "ts", "tsx"]) {
      expect(script).toContain(extension);
    }
    expect(script).toContain("READ_BATCH_SIZE");
    expect(script).toContain("files.slice(offset, offset + READ_BATCH_SIZE)");
    expect(script).toContain('scannedPath.replaceAll("\\\\", "/")');
    expect(script).toContain('normalizedPath.split("/")');
  });
});
