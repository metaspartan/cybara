import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { getAppVersion, getReleaseRepository } from "./build-info";
import { cybaraDir } from "./paths";
import { buildGitHubReleaseApiUrl, compareVersions } from "./versioning";

const cacheDir = join(cybaraDir, "cache");
const cacheFile = join(cacheDir, "update-check.json");

export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseUrl: string | null;
  checkedAt: number;
  cached: boolean;
}

interface CachedEntry {
  checkedAt: number;
  latestVersion: string | null;
  releaseUrl: string | null;
}

function readCache(): CachedEntry | null {
  try {
    if (!existsSync(cacheFile)) return null;
    const parsed = JSON.parse(readFileSync(cacheFile, "utf8")) as Partial<CachedEntry>;
    if (typeof parsed.checkedAt !== "number") return null;
    return {
      checkedAt: parsed.checkedAt,
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : null,
      releaseUrl: typeof parsed.releaseUrl === "string" ? parsed.releaseUrl : null,
    };
  } catch {
    return null;
  }
}

function writeCache(entry: CachedEntry): void {
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(entry, null, 2), "utf8");
  } catch {}
}

function buildResult(
  latestVersion: string | null,
  releaseUrl: string | null,
  checkedAt: number,
  cached: boolean
): UpdateCheckResult {
  const currentVersion = getAppVersion();
  const updateAvailable = !!latestVersion && compareVersions(latestVersion, currentVersion) > 0;
  return {
    updateAvailable,
    latestVersion,
    currentVersion,
    releaseUrl,
    checkedAt,
    cached,
  };
}

export async function checkForUpdate(
  intervalMs: number = DEFAULT_UPDATE_CHECK_INTERVAL_MS
): Promise<UpdateCheckResult> {
  const cached = readCache();
  const now = Date.now();

  if (cached && now - cached.checkedAt < intervalMs) {
    return buildResult(cached.latestVersion, cached.releaseUrl, cached.checkedAt, true);
  }

  const repository = getReleaseRepository();
  const url = buildGitHubReleaseApiUrl(repository);
  let latestVersion: string | null = null;
  let releaseUrl: string | null = null;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "cybara-update-check",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
      };
      latestVersion = (data.tag_name || "").trim().replace(/^v/i, "") || null;
      releaseUrl = data.html_url || null;
    }
  } catch {
    if (cached) {
      return buildResult(cached.latestVersion, cached.releaseUrl, cached.checkedAt, true);
    }
    return buildResult(null, null, now, false);
  }

  writeCache({ checkedAt: now, latestVersion, releaseUrl });
  return buildResult(latestVersion, releaseUrl, now, false);
}

export async function checkForUpdateInBackground(
  intervalMs: number = DEFAULT_UPDATE_CHECK_INTERVAL_MS
): Promise<UpdateCheckResult | null> {
  try {
    return await Promise.race([
      checkForUpdate(intervalMs),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
  } catch {
    return null;
  }
}

export function isUpdateCheckDisabled(): boolean {
  return (
    process.env.CYBARA_DISABLE_UPDATE_CHECK === "1" ||
    process.env.CYBARA_DISABLE_UPDATE_CHECK === "true"
  );
}
