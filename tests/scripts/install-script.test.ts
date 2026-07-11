import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("install.sh production wiring", () => {
  test("supports pinned versions and configurable install paths", () => {
    const source = readFileSync(join(ROOT_DIR, "site", "public", "install.sh"), "utf8");

    expect(source).toContain('VERSION="${CYBARA_VERSION:-latest}"');
    expect(source).toContain("--version");
    expect(source).toContain("CYBARA_INSTALL_DIR");
    expect(source).toContain("CYBARA_RELEASE_REPOSITORY");
    expect(source).toContain("/releases/latest");
    expect(source).toContain("/releases/tags/v${VERSION}");
  });

  test("root forwarder pipes to the hosted installer", () => {
    const source = readFileSync(join(ROOT_DIR, "install.sh"), "utf8");
    expect(source).toContain("https://cybara.ai/install.sh");
    expect(source).toContain('"$@"');
  });
});

describe("install.ps1 production wiring", () => {
  test("verifies checksums and supports arm64 fallback", () => {
    const source = readFileSync(join(ROOT_DIR, "site", "public", "install.ps1"), "utf8");

    expect(source).toContain("CYBARA_VERSION");
    expect(source).toContain("CYBARA_INSTALL_DIR");
    expect(source).toContain("CYBARA_RELEASE_REPOSITORY");
    expect(source).toContain("/releases/latest");
    expect(source).toContain("Get-FileHash");
    expect(source).toContain("-windows-x64-cli.exe");
    expect(source).toContain("arm64");
  });

  test("root forwarder pipes to the hosted installer", () => {
    const source = readFileSync(join(ROOT_DIR, "install.ps1"), "utf8");
    expect(source).toContain("https://cybara.ai/install.ps1");
  });
});
