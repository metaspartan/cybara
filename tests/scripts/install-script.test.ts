import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
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

  test("fails closed when release integrity cannot be verified", () => {
    const source = readFileSync(join(ROOT_DIR, "site", "public", "install.sh"), "utf8");

    expect(source).toContain("Release checksum is missing or malformed; installation aborted.");
    expect(source).toContain(
      "A SHA256 tool is required to verify the release; installation aborted."
    );
    expect(source).toContain(
      'echo "No SHA256 sidecar found for cybara${ASSET_SUFFIX}; installation aborted."'
    );
    expect(source).not.toContain("installing unverified");
    expect(source).not.toContain("skipping verification");
  });

  test("does not install a release whose checksum sidecar is absent", async () => {
    const root = join(
      process.env.TMPDIR || "/tmp",
      `cybara-installer-security-${crypto.randomUUID()}`
    );
    const bin = join(root, "bin");
    const installDir = join(root, "install");
    const releaseJson = join(root, "release.json");
    await Bun.$`mkdir -p ${bin}`;
    writeFileSync(
      releaseJson,
      JSON.stringify({
        tag_name: "v1.2.3",
        assets: [
          {
            browser_download_url: "https://downloads.example/cybara-linux-x64-cli",
          },
        ],
      })
    );
    writeFileSync(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = "-s" ]; then printf Linux; else printf x86_64; fi\n'
    );
    writeFileSync(
      join(bin, "curl"),
      '#!/bin/sh\nout=""\nurl=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -o) out="$2"; shift 2 ;;\n    -*) shift ;;\n    *) url="$1"; shift ;;\n  esac\ndone\ncase "$url" in\n  *api.github.com*) cp "$CYBARA_TEST_RELEASE_JSON" "$out" ;;\n  *) printf binary > "$out" ;;\nesac\n'
    );
    chmodSync(join(bin, "uname"), 0o755);
    chmodSync(join(bin, "curl"), 0o755);

    try {
      const process = Bun.spawn(["bash", join(ROOT_DIR, "site", "public", "install.sh")], {
        cwd: root,
        env: {
          ...Bun.env,
          CYBARA_INSTALL_DIR: installDir,
          CYBARA_TEST_RELEASE_JSON: releaseJson,
          PATH: `${bin}:${Bun.env.PATH || ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("No SHA256 sidecar found");
      expect(stderr).toContain("installation aborted");
      expect(existsSync(join(installDir, "cybara"))).toBe(false);
    } finally {
      await Bun.$`rm -rf ${root}`;
    }
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

  test("fails closed when checksum metadata is absent or malformed", () => {
    const source = readFileSync(join(ROOT_DIR, "site", "public", "install.ps1"), "utf8");

    expect(source).toContain("Release checksum is missing or malformed; installation aborted.");
    expect(source).toContain("No SHA256 sidecar found for $($asset.name); installation aborted.");
    expect(source).not.toContain("installing unverified");
  });

  test("root forwarder pipes to the hosted installer", () => {
    const source = readFileSync(join(ROOT_DIR, "install.ps1"), "utf8");
    expect(source).toContain("https://cybara.ai/install.ps1");
  });
});
