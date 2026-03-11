import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("install.sh production wiring", () => {
  test("supports pinned versions and configurable install paths", () => {
    const source = readFileSync(join(ROOT_DIR, "install.sh"), "utf8");

    expect(source).toContain('VERSION="${CYBARA_VERSION:-latest}"');
    expect(source).toContain("--version");
    expect(source).toContain("CYBARA_INSTALL_DIR");
    expect(source).toContain("CYBARA_RELEASE_REPOSITORY");
    expect(source).toContain("/releases/latest");
    expect(source).toContain("/releases/tags/v${VERSION}");
  });
});
