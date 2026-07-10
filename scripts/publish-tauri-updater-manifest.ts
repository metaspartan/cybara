#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

import {
  TAURI_DESKTOP_UPDATER_PLATFORMS,
  validateTauriUpdaterManifest,
  type TauriUpdaterManifest,
} from "../src/core/versioning";

export type GitHubReleaseAsset = {
  browser_download_url: string;
  id: number;
  name: string;
};

export type GitHubRelease = {
  id: number;
  tag_name: string;
};

export type TauriUpdaterPlatform = {
  signature: string;
  url: string;
};

export type CanonicalTauriUpdaterManifest = {
  notes: string;
  platforms: Record<string, TauriUpdaterPlatform>;
  pub_date: string;
  version: string;
};

type BuildManifestOptions = {
  assets: readonly GitHubReleaseAsset[];
  downloadAssetText: (asset: GitHubReleaseAsset) => Promise<string>;
  /**
   * Resolves the public download URL for an updater asset. Defaults to the
   * asset's `browser_download_url`, but the release pipeline MUST override this
   * with a canonical tag URL: when the manifest is built the release is still a
   * draft, so GitHub reports an `untagged-<id>` download path that 404s the
   * moment the release is published. See `canonicalDownloadUrl`.
   */
  downloadUrl?: (asset: GitHubReleaseAsset) => string;
  notes: string;
  pubDate: string;
  requiredPlatforms?: readonly string[];
  version: string;
};

const DEFAULT_NOTES = "Download the appropriate installer for your platform below.";
const LATEST_JSON = "latest.json";

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/**
 * The stable public download URL for a release asset. This is what GitHub serves
 * once the release is published under its tag, and — unlike the API's
 * `browser_download_url` — it does not change when a draft release is promoted.
 */
export function canonicalDownloadUrl(
  owner: string,
  repo: string,
  tagName: string,
  assetName: string
): string {
  return `https://github.com/${owner}/${repo}/releases/download/${tagName}/${assetName}`;
}

export function resolveUpdaterPlatformKeys(assetName: string): readonly string[] {
  if (/\.msi$/i.test(assetName)) {
    return ["windows-x86_64", "windows-x86_64-msi"];
  }
  if (/\.exe$/i.test(assetName)) {
    return ["windows-x86_64-nsis"];
  }
  if (/\.deb$/i.test(assetName)) {
    return ["linux-x86_64", "linux-x86_64-deb"];
  }
  if (/\.rpm$/i.test(assetName)) {
    return ["linux-x86_64-rpm"];
  }
  if (/\.AppImage$/i.test(assetName)) {
    return ["linux-x86_64-appimage"];
  }
  if (/\.app\.tar\.gz$/i.test(assetName)) {
    if (/_aarch64\.app\.tar\.gz$/i.test(assetName)) {
      return ["darwin-aarch64", "darwin-aarch64-app"];
    }
    if (/_x64\.app\.tar\.gz$/i.test(assetName) || /_x86_64\.app\.tar\.gz$/i.test(assetName)) {
      return ["darwin-x86_64", "darwin-x86_64-app"];
    }
  }
  return [];
}

function versionFromTag(tagName: string): string {
  return tagName.trim().replace(/^v/i, "");
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository '${repository}'. Expected owner/repo.`);
  }
  return { owner, repo };
}

function githubHeaders(token: string, accept = "application/vnd.github+json"): HeadersInit {
  return {
    accept,
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub API request failed for ${url}: HTTP ${response.status}`,
      response.status,
      url
    );
  }
  return (await response.json()) as T;
}

async function getReleaseByTag(
  owner: string,
  repo: string,
  tagName: string,
  token: string
): Promise<GitHubRelease> {
  return githubJson<GitHubRelease>(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`,
    token
  );
}

async function listReleases(owner: string, repo: string, token: string): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  for (let page = 1; ; page += 1) {
    const pageReleases = await githubJson<GitHubRelease[]>(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`,
      token
    );
    releases.push(...pageReleases);
    if (pageReleases.length < 100) break;
  }
  return releases;
}

export async function findReleaseByTag(
  owner: string,
  repo: string,
  tagName: string,
  token: string
): Promise<GitHubRelease> {
  try {
    return await getReleaseByTag(owner, repo, tagName, token);
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error;
    }
    const release = (await listReleases(owner, repo, token)).find(
      (candidate) => candidate.tag_name === tagName
    );
    if (release) return release;
    throw error;
  }
}

async function listReleaseAssets(
  owner: string,
  repo: string,
  releaseId: number,
  token: string
): Promise<GitHubReleaseAsset[]> {
  const assets: GitHubReleaseAsset[] = [];
  for (let page = 1; ; page += 1) {
    const pageAssets = await githubJson<GitHubReleaseAsset[]>(
      `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?per_page=100&page=${page}`,
      token
    );
    assets.push(...pageAssets);
    if (pageAssets.length < 100) break;
  }
  return assets;
}

async function downloadReleaseAssetText(
  owner: string,
  repo: string,
  asset: GitHubReleaseAsset,
  token: string
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`,
    {
      headers: githubHeaders(token, "application/octet-stream"),
    }
  );
  if (!response.ok) {
    throw new Error(`Could not download release asset ${asset.name}: HTTP ${response.status}`);
  }
  return await response.text();
}

async function deleteReleaseAsset(
  owner: string,
  repo: string,
  assetId: number,
  token: string
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`,
    {
      headers: githubHeaders(token),
      method: "DELETE",
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not delete existing ${LATEST_JSON}: HTTP ${response.status}`);
  }
}

async function uploadReleaseAsset(
  owner: string,
  repo: string,
  releaseId: number,
  token: string,
  content: string
): Promise<void> {
  const response = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${LATEST_JSON}`,
    {
      body: content,
      headers: {
        ...githubHeaders(token, "application/vnd.github+json"),
        "content-type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Could not upload ${LATEST_JSON}: HTTP ${response.status} ${details}`);
  }
}

export async function buildTauriUpdaterManifestFromAssets(
  options: BuildManifestOptions
): Promise<CanonicalTauriUpdaterManifest> {
  const assetsByName = new Map(options.assets.map((asset) => [asset.name, asset]));
  const platforms: Record<string, TauriUpdaterPlatform> = {};
  const resolveUrl = options.downloadUrl ?? ((asset) => asset.browser_download_url);

  for (const signatureAsset of options.assets.filter((asset) => asset.name.endsWith(".sig"))) {
    const updaterAssetName = signatureAsset.name.slice(0, -".sig".length);
    const updaterAsset = assetsByName.get(updaterAssetName);
    if (!updaterAsset) continue;

    const platformKeys = resolveUpdaterPlatformKeys(updaterAsset.name);
    if (platformKeys.length === 0) continue;

    const signature = await options.downloadAssetText(signatureAsset);
    const url = resolveUrl(updaterAsset);
    for (const platformKey of platformKeys) {
      platforms[platformKey] = {
        signature,
        url,
      };
    }
  }

  const manifest: CanonicalTauriUpdaterManifest = {
    version: options.version,
    notes: options.notes,
    pub_date: options.pubDate,
    platforms,
  };
  const requiredPlatforms = options.requiredPlatforms ?? TAURI_DESKTOP_UPDATER_PLATFORMS;
  const validation = validateTauriUpdaterManifest(
    manifest as TauriUpdaterManifest,
    requiredPlatforms
  );

  if (!validation.ok) {
    const details = [
      validation.missingPlatforms.length > 0
        ? `missing platform(s): ${validation.missingPlatforms.join(", ")}`
        : "",
      validation.invalidPlatforms.length > 0
        ? `invalid platform entries: ${validation.invalidPlatforms.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`Generated Tauri updater manifest is not complete: ${details}`);
  }

  return manifest;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

if (import.meta.main) {
  const tagName = Bun.argv[2]?.trim() || process.env.TAG?.trim() || process.env.GITHUB_REF_NAME;
  if (!tagName) {
    console.error(`Usage: bun run scripts/publish-tauri-updater-manifest.ts <tag> [output-path]`);
    process.exit(1);
  }

  const outputPath = Bun.argv[3]?.trim() || "release-check/latest.json";
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    console.error("GH_TOKEN or GITHUB_TOKEN is required.");
    process.exit(1);
  }

  try {
    const repository =
      process.env.GITHUB_REPOSITORY?.trim() || requireEnv("CYBARA_RELEASE_REPOSITORY");
    const { owner, repo } = splitRepository(repository);
    const release = await findReleaseByTag(owner, repo, tagName, token);
    const assets = await listReleaseAssets(owner, repo, release.id, token);
    const manifest = await buildTauriUpdaterManifestFromAssets({
      assets,
      downloadAssetText: (asset) => downloadReleaseAssetText(owner, repo, asset, token),
      // Build canonical tag URLs, not the draft-release `browser_download_url`.
      // The manifest is generated while the release is still a draft, so the API
      // reports an `untagged-<id>` path that 404s once the release is published —
      // exactly the in-app updater download failure this pipeline had.
      downloadUrl: (asset) => canonicalDownloadUrl(owner, repo, release.tag_name, asset.name),
      notes: process.env.CYBARA_TAURI_UPDATER_NOTES?.trim() || DEFAULT_NOTES,
      pubDate: new Date().toISOString(),
      version: versionFromTag(release.tag_name),
    });
    const content = `${JSON.stringify(manifest, null, 2)}\n`;

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content, "utf-8");

    const existingLatest = assets.find((asset) => asset.name === LATEST_JSON);
    if (existingLatest) {
      await deleteReleaseAsset(owner, repo, existingLatest.id, token);
    }
    await uploadReleaseAsset(owner, repo, release.id, token, content);

    console.log(
      `Published ${LATEST_JSON} for ${release.tag_name} with ${Object.keys(manifest.platforms).length} updater platform entries.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
