import { describe, expect, test } from "bun:test";

import {
  TAURI_DESKTOP_UPDATER_PLATFORMS,
  TAURI_WINDOWS_X64_MSI_FALLBACK_PLATFORMS,
  TAURI_WINDOWS_X64_RELEASE_PLATFORMS,
  buildGitHubReleasesPageUrl,
  buildGitHubReleaseApiUrl,
  buildGitHubUpdaterEndpoint,
  buildTauriReleaseConfigPatch,
  computeReleaseVersion,
  normalizeReleaseTag,
  replaceCargoTomlVersion,
  replaceJsonVersion,
  resolveReleaseAssetBasename,
  resolveReleaseBinaryFilename,
  resolveSelfUpdateDestination,
  validateTauriUpdaterManifest,
} from "../../src/core/versioning";

describe("versioning helpers", () => {
  test("computes commit-count versions from a base semver", () => {
    expect(computeReleaseVersion("1.0.0", 42)).toBe("1.0.42");
    expect(computeReleaseVersion("3.7.9", 105)).toBe("3.7.105");
  });

  test("normalizes release tags and URLs", () => {
    expect(normalizeReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(buildGitHubReleaseApiUrl("metaspartan/cybara", "v1.2.3")).toBe(
      "https://api.github.com/repos/metaspartan/cybara/releases/tags/v1.2.3"
    );
    expect(buildGitHubReleaseApiUrl("metaspartan/cybara")).toBe(
      "https://api.github.com/repos/metaspartan/cybara/releases/latest"
    );
    expect(buildGitHubUpdaterEndpoint("metaspartan/cybara")).toBe(
      "https://github.com/metaspartan/cybara/releases/latest/download/latest.json"
    );
    expect(buildGitHubReleasesPageUrl("metaspartan/cybara")).toBe(
      "https://github.com/metaspartan/cybara/releases"
    );
  });

  test("replaces versions across JSON and Cargo manifests", () => {
    expect(replaceJsonVersion('{"name":"cybara","version":"1.0.0"}', "1.0.44")).toContain(
      '"version": "1.0.44"'
    );
    expect(
      replaceCargoTomlVersion('[package]\nname = "cybara"\nversion = "1.0.0"\n', "1.0.44")
    ).toContain('version = "1.0.44"');
  });

  test("maps release assets for each supported CLI target", () => {
    expect(resolveReleaseAssetBasename("darwin", "arm64")).toBe("cybara-darwin-arm64");
    expect(resolveReleaseAssetBasename("darwin", "x64")).toBe("cybara-darwin-x64");
    expect(resolveReleaseAssetBasename("linux", "x86_64")).toBe("cybara-linux-x64");
    expect(resolveReleaseBinaryFilename("windows", "x64")).toBe("cybara-windows-x64.exe");
  });

  test("keeps self-updates on the current binary when already running from cybara", () => {
    expect(resolveSelfUpdateDestination("/usr/local/bin/cybara", "darwin", "/tmp/home")).toBe(
      "/usr/local/bin/cybara"
    );
    expect(resolveSelfUpdateDestination("/usr/bin/bun", "linux", "/tmp/home")).toBe(
      "/tmp/home/.local/bin/cybara"
    );
  });

  test("builds a release-only Tauri updater patch", () => {
    expect(buildTauriReleaseConfigPatch("metaspartan/cybara", "PUBLIC_KEY", null)).toEqual({
      bundle: {
        createUpdaterArtifacts: true,
      },
      plugins: {
        updater: {
          endpoints: ["https://github.com/metaspartan/cybara/releases/latest/download/latest.json"],
          pubkey: "PUBLIC_KEY",
        },
      },
    });
  });

  test("validates Windows Tauri updater platform keys before publishing a release", () => {
    const manifest = {
      version: "1.0.582",
      platforms: {
        "linux-x86_64": {
          signature: "linux-signature",
          url: "https://example.com/cybara.deb",
        },
        "windows-x86_64-msi": {
          signature: "msi-signature",
          url: "https://example.com/cybara.msi",
        },
        "windows-x86_64": {
          signature: "msi-signature",
          url: "https://example.com/cybara.msi",
        },
        "windows-x86_64-nsis": {
          signature: "nsis-signature",
          url: "https://example.com/cybara-setup.exe",
        },
      },
    };

    expect(TAURI_WINDOWS_X64_MSI_FALLBACK_PLATFORMS).toEqual([
      "windows-x86_64-msi",
      "windows-x86_64",
    ]);
    expect(TAURI_DESKTOP_UPDATER_PLATFORMS).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-x86_64",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
    expect(validateTauriUpdaterManifest(manifest).ok).toBe(true);

    delete manifest.platforms["windows-x86_64-msi"];
    expect(validateTauriUpdaterManifest(manifest).missingPlatforms).toEqual(["windows-x86_64-msi"]);

    manifest.platforms["windows-x86_64-msi"] = {
      signature: "",
      url: "https://example.com/cybara.msi",
    };
    expect(
      validateTauriUpdaterManifest(manifest, TAURI_WINDOWS_X64_RELEASE_PLATFORMS).invalidPlatforms
    ).toEqual(["windows-x86_64-msi"]);
  });
});
