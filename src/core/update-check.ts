/**
 * Non-blocking, cached "update available" probe.
 *
 * Used by the TUI and web UI to surface a gentle banner when a newer Cybara
 * release is published on GitHub. It is throttled (default 6h) and cached to
 * disk so it never blocks startup or spams the GitHub API. All failures
 * (offline, rate-limited, malformed response) resolve silently to "no info".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { getAppVersion, getReleaseRepository } from "./build-info";
import { cybaraDir } from "./paths";
import { buildGitHubReleaseApiUrl, compareVersions } from "./versioning";

const cacheDir = join(cybaraDir, "cache");
const cacheFile = join(cacheDir, "update-check.json");

/** Default throttle: re-check at most once every 6 hours. */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  /** True when a strictly newer release than the running build was found. */
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseUrl: string | null;
  /** Epoch ms when this result was last refreshed. */
  checkedAt: number;
  /** True when the result came from cache (no network call was made). */
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
  } catch {
    // Cache is best-effort; ignore write errors.
  }
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

/**
 * Check for an available update. Returns a cached result if the last check was
 * within `intervalMs`; otherwise performs one network request. Never throws.
 */
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
    // Offline / rate-limited — fall back to stale cache if present.
    if (cached) {
      return buildResult(cached.latestVersion, cached.releaseUrl, cached.checkedAt, true);
    }
    return buildResult(null, null, now, false);
  }

  writeCache({ checkedAt: now, latestVersion, releaseUrl });
  return buildResult(latestVersion, releaseUrl, now, false);
}

/**
 * Convenience wrapper for fire-and-forget startup probes. Returns the result if
 * it resolves quickly, or null on timeout — callers should never await this on
 * the critical path.
 */
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

/** Disable the check at runtime (e.g. for tests or offline-first users). */
export function isUpdateCheckDisabled(): boolean {
  return (
    process.env.CYBARA_DISABLE_UPDATE_CHECK === "1" ||
    process.env.CYBARA_DISABLE_UPDATE_CHECK === "true"
  );
}
