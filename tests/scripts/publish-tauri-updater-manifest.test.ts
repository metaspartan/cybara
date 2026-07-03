import { describe, expect, test } from "bun:test";

import {
  buildTauriUpdaterManifestFromAssets,
  findReleaseByTag,
  resolveUpdaterPlatformKeys,
  type GitHubReleaseAsset,
} from "../../scripts/publish-tauri-updater-manifest";
import { TAURI_DESKTOP_UPDATER_PLATFORMS } from "../../src/core/versioning";

function asset(id: number, name: string): GitHubReleaseAsset {
  return {
    id,
    name,
    browser_download_url: `https://github.com/metaspartan/cybara/releases/download/v1.0.619/${name}`,
  };
}

function updaterAssets(names: readonly string[]): GitHubReleaseAsset[] {
  return names.flatMap((name, index) => [
    asset(index * 2 + 1, name),
    asset(index * 2 + 2, `${name}.sig`),
  ]);
}

describe("Tauri updater manifest publisher", () => {
  test("maps Tauri release assets to canonical updater platform keys", () => {
    expect(resolveUpdaterPlatformKeys("Cybara_1.0.619_x64_en-US.msi")).toEqual([
      "windows-x86_64",
      "windows-x86_64-msi",
    ]);
    expect(resolveUpdaterPlatformKeys("Cybara_1.0.619_x64-setup.exe")).toEqual([
      "windows-x86_64-nsis",
    ]);
    expect(resolveUpdaterPlatformKeys("Cybara_x64.app.tar.gz")).toEqual([
      "darwin-x86_64",
      "darwin-x86_64-app",
    ]);
    expect(resolveUpdaterPlatformKeys("Cybara_aarch64.app.tar.gz")).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
    ]);
  });

  test("builds a complete canonical latest.json from release assets and signatures", async () => {
    const assets = updaterAssets([
      "Cybara_1.0.619_x64_en-US.msi",
      "Cybara_1.0.619_x64-setup.exe",
      "Cybara_1.0.619_amd64.deb",
      "Cybara-1.0.619-1.x86_64.rpm",
      "Cybara_x64.app.tar.gz",
      "Cybara_aarch64.app.tar.gz",
    ]);

    const manifest = await buildTauriUpdaterManifestFromAssets({
      assets,
      downloadAssetText: async (releaseAsset) => `signature for ${releaseAsset.name}`,
      notes: "Download the appropriate installer for your platform below.",
      pubDate: "2026-07-03T00:00:00.000Z",
      version: "1.0.619",
    });

    expect(manifest.version).toBe("1.0.619");
    expect(Object.keys(manifest.platforms).sort()).toEqual(
      [...TAURI_DESKTOP_UPDATER_PLATFORMS].sort()
    );
    expect(manifest.platforms["windows-x86_64"].url).toContain("Cybara_1.0.619_x64_en-US.msi");
    expect(manifest.platforms["windows-x86_64-msi"]).toEqual(manifest.platforms["windows-x86_64"]);
    expect(manifest.platforms["darwin-aarch64"].url).toContain("Cybara_aarch64.app.tar.gz");
  });

  test("fails closed when a Darwin updater signature is missing", async () => {
    const assets = updaterAssets([
      "Cybara_1.0.619_x64_en-US.msi",
      "Cybara_1.0.619_x64-setup.exe",
      "Cybara_1.0.619_amd64.deb",
      "Cybara-1.0.619-1.x86_64.rpm",
      "Cybara_x64.app.tar.gz",
    ]);

    await expect(
      buildTauriUpdaterManifestFromAssets({
        assets,
        downloadAssetText: async (releaseAsset) => `signature for ${releaseAsset.name}`,
        notes: "Download the appropriate installer for your platform below.",
        pubDate: "2026-07-03T00:00:00.000Z",
        version: "1.0.619",
      })
    ).rejects.toThrow("darwin-aarch64");
  });

  test("falls back to release listing when the tag endpoint cannot see a draft release", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/releases/tags/v1.0.625")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/releases?per_page=100&page=1")) {
        return Response.json([
          {
            id: 625,
            tag_name: "v1.0.625",
          },
        ]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      await expect(findReleaseByTag("metaspartan", "cybara", "v1.0.625", "token")).resolves.toEqual(
        {
          id: 625,
          tag_name: "v1.0.625",
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/metaspartan/cybara/releases/tags/v1.0.625",
      "https://api.github.com/repos/metaspartan/cybara/releases?per_page=100&page=1",
    ]);
  });
});
