/**
 * File-path safety policy for write/edit/apply_patch handlers.
 *
 * Cybara's file handlers historically could write anywhere the process user
 * could touch. This module enforces a hard deny-list of sensitive paths
 * (credentials, keys, env files) and an optional workspace-confinement mode.
 *
 * The deny-list is deliberately conservative: it blocks the common locations of
 * secrets and machine credentials. Workspace confinement is opt-in because many
 * legitimate agent workflows intentionally edit files outside the CWD (dotfiles,
 * notes, config).
 */
import { homedir } from "os";
import { resolve, isAbsolute } from "path";

/** Reason a path was rejected. */
export type PathPolicyDenialReason = "sensitive-path" | "outside-workspace" | "empty-path";

export interface PathPolicyDecision {
  allowed: boolean;
  reason?: PathPolicyDenialReason;
  resolvedPath: string;
}

/** Filename patterns (lowercased, matched anywhere in the basename) that are always denied. */
const DENY_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^id_[a-z0-9-]+$/i, // id_rsa, id_ed25519, etc.
  /^authorized_keys$/i,
  /^known_hosts$/i,
  /\.netrc$/i,
  /^\.pgpass$/i,
  /^\.my\.cnf$/i,
  /^credentials(\.json|\.db)?$/i,
  /(^|[\\/])\.aws[\\/].*$/i,
  /(^|[\\/])\.config[\\/]gcloud[\\/].*$/i,
  /(^|[\\/])\.docker[\\/]config\.json$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.git-credentials$/i,
  /^\.gitconfig$/i,
  /^\.htpasswd$/i,
  /(^|[\\/])\.kube[\\/]config$/i,
  /oauth.*\.(json|token)$/i,
  /service[_-]?account.*\.json$/i,
];

/**
 * Absolute path segments (resolved against the home dir) that are always denied
 * when a target path is equal to or nested beneath them.
 */
const DENY_PATH_SEGMENTS: readonly string[] = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".cybara", // Cybara's own data dir: provider-keys DB, encrypted wallet, sessions
  "Library/Cookies",
  "Library/Keychains",
];

export interface PathPolicyOptions {
  /** When true, only paths under `workspaceRoot` are allowed. */
  confineToWorkspace?: boolean;
  /** Root directory for confinement checks. */
  workspaceRoot?: string;
  /** Optional extra allow/deny prefixes (e.g. from user config). */
  extraDenyPrefixes?: string[];
  /** Allow the policy to be disabled entirely (e.g. trusted local-only setups). */
  disabled?: boolean;
}

function normalize(p: string): string {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

function matchesDenyPattern(resolvedPath: string): boolean {
  const lower = resolvedPath.toLowerCase();
  const basename = lower.split("/").pop() ?? "";
  // Match against the trailing path component(s) for the segment-style rules.
  for (const pattern of DENY_FILENAME_PATTERNS) {
    // Some patterns include a path separator (e.g. ".aws/..."); test against the
    // whole path; others are basename-only — test against basename.
    if (pattern.source.includes("\\/") || pattern.source.includes("/")) {
      if (pattern.test(lower) || pattern.test(resolvedPath)) return true;
    } else if (pattern.test(basename)) {
      return true;
    }
  }
  return false;
}

function isUnderHomeSubdir(resolvedPath: string, segment: string): boolean {
  const home = homedir().replace(/\\/g, "/").toLowerCase();
  const marker = `${home}/${segment.toLowerCase()}`;
  const markerNoSlash = marker.replace(/\/$/, "");
  return resolvedPath === markerNoSlash || resolvedPath.startsWith(`${markerNoSlash}/`);
}

/**
 * Decide whether a path may be written. Pure function — safe to unit-test.
 * Accepts `undefined` so callers can pass an optional/unvalidated value and get
 * a structured "empty-path" denial instead of a runtime error.
 */
export function checkWritePath(
  rawPath: string | undefined,
  options: PathPolicyOptions = {}
): PathPolicyDecision {
  const resolved = normalize(rawPath ?? "");

  if (!rawPath || !resolved) {
    return { allowed: false, reason: "empty-path", resolvedPath: resolved };
  }

  if (options.disabled) {
    return { allowed: true, resolvedPath: resolved };
  }

  if (matchesDenyPattern(resolved)) {
    return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
  }

  for (const segment of DENY_PATH_SEGMENTS) {
    if (isUnderHomeSubdir(resolved, segment)) {
      return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
    }
  }

  for (const prefix of options.extraDenyPrefixes ?? []) {
    const normalizedPrefix = normalize(prefix);
    if (resolved === normalizedPrefix || resolved.startsWith(`${normalizedPrefix}/`)) {
      return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
    }
  }

  if (options.confineToWorkspace && options.workspaceRoot) {
    const root = normalize(options.workspaceRoot).replace(/\/$/, "");
    if (!isAbsolute(root) || (resolved !== root && !resolved.startsWith(`${root}/`))) {
      return { allowed: false, reason: "outside-workspace", resolvedPath: resolved };
    }
  }

  return { allowed: true, resolvedPath: resolved };
}

/** Human-readable message for a denial, suitable for a tool result. */
export function describeDenial(reason: PathPolicyDenialReason): string {
  switch (reason) {
    case "sensitive-path":
      return "Refused: the path points at a sensitive credential or key file. Write to a non-sensitive location instead.";
    case "outside-workspace":
      return "Refused: the path is outside the configured workspace root.";
    case "empty-path":
      return "Refused: no path was provided.";
  }
}

/** Convenience helper used by file handlers. */
export function assertWritablePath(
  rawPath: string | undefined,
  options?: PathPolicyOptions
): string {
  const decision = checkWritePath(rawPath, options);
  if (!decision.allowed) {
    throw new Error(describeDenial(decision.reason!));
  }
  return decision.resolvedPath;
}

/**
 * Read-side guard. The same sensitive-file deny-list applies to reads — an
 * agent/prompt-injection must not be able to read `~/.ssh/id_rsa`, `.env`,
 * `~/.aws/credentials`, etc. and exfiltrate them. Reuses checkWritePath's rules
 * (workspace confinement is opt-in via options, same as writes).
 */
export function assertReadablePath(
  rawPath: string | undefined,
  options?: PathPolicyOptions
): string {
  const decision = checkWritePath(rawPath, options);
  if (!decision.allowed) {
    const message =
      decision.reason === "sensitive-path"
        ? "Refused: reading this path is blocked — it points at a sensitive credential or key file."
        : describeDenial(decision.reason!);
    throw new Error(message);
  }
  return decision.resolvedPath;
}
