import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CUA_DRIVER_VERSION,
  cuaDriverExecutableName,
  getCuaDriverRelease,
  getCuaDriverTarget,
  ensureManagedCuaDriver,
  installCuaDriverAt,
  managedCuaDriverDir,
  packagedCuaDriverCandidates,
} from "../../src/core/cua-driver-runtime";

function createTarArchive(): { archive: Buffer; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cybara-cua-driver-archive-"));
  const payload = join(root, "payload");
  const archivePath = join(root, "driver.tar.gz");
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, "cua-driver"), "driver-binary");
  const result = Bun.spawnSync(["tar", "-czf", archivePath, "-C", payload, "cua-driver"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return {
    archive: readFileSync(archivePath),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("computer-use driver runtime", () => {
  test("maps every supported release target", () => {
    expect(getCuaDriverTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(getCuaDriverTarget("darwin", "x64")).toBe("darwin-x64");
    expect(getCuaDriverTarget("linux", "arm64")).toBe("linux-arm64");
    expect(getCuaDriverTarget("linux", "x64")).toBe("linux-x64");
    expect(getCuaDriverTarget("win32", "arm64")).toBe("windows-arm64");
    expect(getCuaDriverTarget("win32", "x64")).toBe("windows-x64");
    expect(getCuaDriverTarget("freebsd", "x64")).toBeNull();
  });

  test("pins release assets and checksums for each platform", () => {
    expect(getCuaDriverRelease("darwin-arm64")).toEqual({
      asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
      sha256: "43a78c1789c6f0fff12f87b5d4089e4d4da5f256832ca9a7c5f5fdaa79ba76d4",
    });
    expect(getCuaDriverRelease("windows-x64").asset).toEndWith("windows-x86_64-binary.zip");
    expect(getCuaDriverRelease("linux-arm64").asset).toEndWith("linux-arm64-binary.tar.gz");
    expect(cuaDriverExecutableName("windows-arm64")).toBe("cua-driver.exe");
    expect(cuaDriverExecutableName("linux-x64")).toBe("cua-driver");
  });

  test("resolves packaged and managed runtime locations", () => {
    expect(
      packagedCuaDriverCandidates(
        "darwin",
        { CYBARA_RESOURCE_DIR: "/Applications/Cybara.app/Contents/Resources" },
        "/Applications/Cybara.app/Contents/MacOS/Cybara"
      )[0]
    ).toBe("/Applications/Cybara.app/Contents/Resources/cua-driver/cua-driver");
    expect(managedCuaDriverDir("/Users/tester")).toBe(
      `/Users/tester/.cybara/runtime/cua-driver/${CUA_DRIVER_VERSION}`
    );
  });

  test("installs a verified archive with version and license metadata", async () => {
    const source = createTarArchive();
    const destinationRoot = mkdtempSync(join(tmpdir(), "cybara-cua-driver-install-"));
    try {
      const sha256 = createHash("sha256").update(source.archive).digest("hex");
      const fetcher: typeof fetch = async () => new Response(source.archive, { status: 200 });
      const executable = await installCuaDriverAt(destinationRoot, "linux-x64", fetcher, {
        asset: "test-driver.tar.gz",
        sha256,
      });

      expect(readFileSync(executable, "utf8")).toBe("driver-binary");
      expect(readFileSync(join(destinationRoot, ".version"), "utf8").trim()).toBe(
        CUA_DRIVER_VERSION
      );
      expect(readFileSync(join(destinationRoot, ".target"), "utf8").trim()).toBe("linux-x64");
      expect(readFileSync(join(destinationRoot, "LICENSE.md"), "utf8")).toContain("MIT License");
      expect(existsSync(executable)).toBe(true);
    } finally {
      source.cleanup();
      rmSync(destinationRoot, { recursive: true, force: true });
    }
  });

  test("rejects an archive that does not match its pinned checksum", async () => {
    const destinationRoot = mkdtempSync(join(tmpdir(), "cybara-cua-driver-reject-"));
    try {
      const fetcher: typeof fetch = async () => new Response("tampered", { status: 200 });
      await expect(
        installCuaDriverAt(destinationRoot, "linux-x64", fetcher, {
          asset: "test-driver.tar.gz",
          sha256: "0".repeat(64),
        })
      ).rejects.toThrow("checksum verification failed");
    } finally {
      rmSync(destinationRoot, { recursive: true, force: true });
    }
  });

  test("coalesces concurrent managed runtime installs", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-cua-driver-home-"));
    let requests = 0;
    try {
      const fetcher: typeof fetch = async () => {
        requests += 1;
        await Bun.sleep(10);
        return new Response("offline", { status: 503 });
      };
      const results = await Promise.allSettled([
        ensureManagedCuaDriver("linux", "x64", home, fetcher),
        ensureManagedCuaDriver("linux", "x64", home, fetcher),
      ]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(requests).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
