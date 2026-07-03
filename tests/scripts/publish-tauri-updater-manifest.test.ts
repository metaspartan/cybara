import { describe, expect, test } from "bun:test";

import {
  buildTauriUpdaterManifestFromAssets,
  canonicalDownloadUrl,
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

// Mimics the GitHub API while a release is still a DRAFT: browser_download_url
// uses an `untagged-<id>` path that 404s the moment the release is published.
function draftAsset(id: number, name: string): GitHubReleaseAsset {
  return {
    id,
    name,
    browser_download_url: `https://github.com/metaspartan/cybara/releases/download/untagged-c7272da8b1134df24a19/${name}`,
  };
}

function draftUpdaterAssets(names: readonly string[]): GitHubReleaseAsset[] {
  return names.flatMap((name, index) => [
    draftAsset(index * 2 + 1, name),
    draftAsset(index * 2 + 2, `${name}.sig`),
  ]);
}

const ALL_UPDATER_ASSET_NAMES = [
  "Cybara_1.0.627_x64_en-US.msi",
  "Cybara_1.0.627_x64-setup.exe",
  "Cybara_1.0.627_amd64.deb",
  "Cybara-1.0.627-1.x86_64.rpm",
  "Cybara_x64.app.tar.gz",
  "Cybara_aarch64.app.tar.gz",
] as const;

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

  test("canonicalDownloadUrl builds the stable published-tag path", () => {
    expect(
      canonicalDownloadUrl("metaspartan", "cybara", "v1.0.627", "Cybara_1.0.627_x64_en-US.msi")
    ).toBe(
      "https://github.com/metaspartan/cybara/releases/download/v1.0.627/Cybara_1.0.627_x64_en-US.msi"
    );
  });

  test("REGRESSION: draft `untagged-` download URLs are rewritten to the canonical tag URL", async () => {
    // The manifest is generated while the release is a draft, so every asset's
    // browser_download_url points at an `untagged-<id>` path that 404s once the
    // release is published — the exact in-app updater failure being fixed.
    const assets = draftUpdaterAssets(ALL_UPDATER_ASSET_NAMES);

    const manifest = await buildTauriUpdaterManifestFromAssets({
      assets,
      downloadAssetText: async (releaseAsset) => `signature for ${releaseAsset.name}`,
      downloadUrl: (releaseAsset) =>
        canonicalDownloadUrl("metaspartan", "cybara", "v1.0.627", releaseAsset.name),
      notes: "notes",
      pubDate: "2026-07-03T00:00:00.000Z",
      version: "1.0.627",
    });

    // No platform may keep a draft `untagged-` URL — that is the download 404.
    for (const [platform, entry] of Object.entries(manifest.platforms)) {
      expect(entry.url, `${platform} must not use a draft URL`).not.toContain("untagged-");
      expect(entry.url).toContain("/releases/download/v1.0.627/");
    }
    // Windows specifically (the reported failure): MSI + NSIS resolve to the tag.
    expect(manifest.platforms["windows-x86_64"].url).toBe(
      "https://github.com/metaspartan/cybara/releases/download/v1.0.627/Cybara_1.0.627_x64_en-US.msi"
    );
    expect(manifest.platforms["windows-x86_64-nsis"].url).toBe(
      "https://github.com/metaspartan/cybara/releases/download/v1.0.627/Cybara_1.0.627_x64-setup.exe"
    );
  });

  test("without a resolver, falls back to the asset browser_download_url (backward compatible)", async () => {
    const assets = updaterAssets(ALL_UPDATER_ASSET_NAMES);
    const manifest = await buildTauriUpdaterManifestFromAssets({
      assets,
      downloadAssetText: async (releaseAsset) => `signature for ${releaseAsset.name}`,
      notes: "notes",
      pubDate: "2026-07-03T00:00:00.000Z",
      version: "1.0.627",
    });
    expect(manifest.platforms["windows-x86_64"].url).toContain(
      "/releases/download/v1.0.619/Cybara_1.0.627_x64_en-US.msi"
    );
  });

  test("build fails closed if draft `untagged-` URLs would ship (no resolver override)", async () => {
    // Even if a future caller forgets the canonical resolver, the manifest build
    // must not emit draft URLs — the validator now rejects them.
    const assets = draftUpdaterAssets(ALL_UPDATER_ASSET_NAMES);
    await expect(
      buildTauriUpdaterManifestFromAssets({
        assets,
        downloadAssetText: async (releaseAsset) => `signature for ${releaseAsset.name}`,
        notes: "notes",
        pubDate: "2026-07-03T00:00:00.000Z",
        version: "1.0.627",
      })
    ).rejects.toThrow(/not complete|invalid/i);
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
