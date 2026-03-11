import packageJson from "../../package.json";
import { DEFAULT_RELEASE_REPOSITORY } from "./versioning";

function normalizeRepositoryUrl(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (
    value &&
    typeof value === "object" &&
    "url" in value &&
    typeof (value as { url?: unknown }).url === "string"
  ) {
    const url = (value as { url: string }).url.trim();
    if (url) return url;
  }
  return `https://github.com/${DEFAULT_RELEASE_REPOSITORY}.git`;
}

function extractRepositorySlug(url: string): string {
  const normalized = url.trim();
  const match = normalized.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/i);
  return match?.[1] || DEFAULT_RELEASE_REPOSITORY;
}

const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";
const packageRepositoryUrl = normalizeRepositoryUrl(packageJson.repository);

export function getAppVersion(): string {
  const override = process.env.CYBARA_VERSION?.trim();
  return override || packageVersion || "unknown";
}

export function getReleaseRepository(): string {
  const override = process.env.CYBARA_RELEASE_REPOSITORY?.trim();
  return override || extractRepositorySlug(packageRepositoryUrl);
}

export function getReleaseRepositoryUrl(): string {
  return `https://github.com/${getReleaseRepository()}`;
}
