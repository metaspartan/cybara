import { config } from "../../config";

const ANY_HOST = "*";

function tryParseHostname(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeHostPattern(pattern: string): string {
  const trimmed = pattern.trim().toLowerCase();
  if (!trimmed) return "";
  const parsedHost = tryParseHostname(trimmed);
  if (parsedHost) return parsedHost;
  return trimmed;
}

function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (pattern === ANY_HOST) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

function hostAllowed(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const hostname = tryParseHostname(url);
  if (!hostname) return false;

  const normalizedPatterns = patterns.map(normalizeHostPattern).filter(Boolean);
  return normalizedPatterns.some((pattern) => matchesHostPattern(hostname, pattern));
}

export function enforceWebFetchAllowlist(url: string): void {
  const policy = config.getWebToolUrlPolicy();
  if (!policy.enabled) return;
  if (policy.fetch_allowlist.length === 0) return;

  if (!hostAllowed(url, policy.fetch_allowlist)) {
    const host = tryParseHostname(url) || "unknown";
    throw new Error(
      `Validation error: URL host '${host}' is not allowlisted for web_fetch by web tool policy`
    );
  }
}

export function filterWebSearchResultsByAllowlist<
  T extends {
    url: string;
  },
>(results: T[]): T[] {
  const policy = config.getWebToolUrlPolicy();
  if (!policy.enabled) return results;
  if (policy.search_result_allowlist.length === 0) return results;

  return results.filter((result) => hostAllowed(result.url, policy.search_result_allowlist));
}
