import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { resolve, isAbsolute, dirname, join } from "path";

export type PathPolicyDenialReason = "sensitive-path" | "outside-workspace" | "empty-path";

export interface PathPolicyDecision {
  allowed: boolean;
  reason?: PathPolicyDenialReason;
  resolvedPath: string;
}

const DENY_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^id_[a-z0-9-]+$/i,
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

const DENY_PATH_SEGMENTS: readonly string[] = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".cybara",
  "Library/Cookies",
  "Library/Keychains",
];

export interface PathPolicyOptions {
  confineToWorkspace?: boolean;
  workspaceRoot?: string;
  extraDenyPrefixes?: string[];
  disabled?: boolean;
}

function normalize(p: string): string {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

function resolvePath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

function realPolicyPath(p: string): string | undefined {
  const absolute = resolve(p);
  try {
    if (existsSync(absolute)) {
      return realpathSync.native(absolute);
    }
  } catch {
    return undefined;
  }

  let parent = dirname(absolute);
  while (parent && parent !== dirname(parent) && !existsSync(parent)) {
    parent = dirname(parent);
  }
  if (!existsSync(parent)) return undefined;

  try {
    const realParent = realpathSync.native(parent);
    const suffix = absolute.slice(parent.length).replace(/^[\\/]+/, "");
    return suffix ? join(realParent, suffix) : realParent;
  } catch {
    return undefined;
  }
}

function policyPaths(rawPath: string): string[] {
  const paths = [normalize(rawPath)];
  const real = realPolicyPath(rawPath);
  if (real) {
    const normalizedReal = normalize(real);
    if (!paths.includes(normalizedReal)) paths.push(normalizedReal);
  }
  return paths;
}

function matchesDenyPattern(resolvedPath: string): boolean {
  const lower = resolvedPath.toLowerCase();
  const basename = lower.split("/").pop() ?? "";
  for (const pattern of DENY_FILENAME_PATTERNS) {
    if (pattern.source.includes("\\/") || pattern.source.includes("/")) {
      if (pattern.test(lower) || pattern.test(resolvedPath)) return true;
    } else if (pattern.test(basename)) {
      return true;
    }
  }
  return false;
}

function homePolicyRoots(): string[] {
  const roots = [normalize(homedir())];
  try {
    const realHome = normalize(realpathSync.native(homedir()));
    if (!roots.includes(realHome)) roots.push(realHome);
  } catch {
    return roots;
  }
  return roots;
}

function isUnderHomeSubdir(resolvedPath: string, segment: string): boolean {
  return homePolicyRoots().some((home) => {
    const marker = `${home}/${segment.toLowerCase()}`.replace(/\/$/, "");
    return resolvedPath === marker || resolvedPath.startsWith(`${marker}/`);
  });
}

export function checkWritePath(
  rawPath: string | undefined,
  options: PathPolicyOptions = {}
): PathPolicyDecision {
  const resolved = resolvePath(rawPath ?? "");

  if (!rawPath || !resolved) {
    return { allowed: false, reason: "empty-path", resolvedPath: resolved };
  }

  if (options.disabled) {
    return { allowed: true, resolvedPath: resolved };
  }

  const candidates = policyPaths(rawPath);

  for (const candidate of candidates) {
    if (matchesDenyPattern(candidate)) {
      return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
    }

    for (const segment of DENY_PATH_SEGMENTS) {
      if (isUnderHomeSubdir(candidate, segment)) {
        return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
      }
    }

    for (const prefix of options.extraDenyPrefixes ?? []) {
      const prefixCandidates = policyPaths(prefix);
      if (
        prefixCandidates.some(
          (normalizedPrefix) =>
            candidate === normalizedPrefix || candidate.startsWith(`${normalizedPrefix}/`)
        )
      ) {
        return { allowed: false, reason: "sensitive-path", resolvedPath: resolved };
      }
    }
  }

  if (options.confineToWorkspace) {
    if (!options.workspaceRoot) {
      return { allowed: false, reason: "outside-workspace", resolvedPath: resolved };
    }
    const roots = policyPaths(options.workspaceRoot).map((root) => root.replace(/\/$/, ""));
    if (roots.some((root) => !isAbsolute(root))) {
      return { allowed: false, reason: "outside-workspace", resolvedPath: resolved };
    }
    for (const candidate of candidates) {
      const underWorkspace = roots.some(
        (root) => candidate === root || candidate.startsWith(`${root}/`)
      );
      if (!underWorkspace) {
        return { allowed: false, reason: "outside-workspace", resolvedPath: resolved };
      }
    }
  }

  return { allowed: true, resolvedPath: resolved };
}

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

const READABLE_CYBARA_SUBDIRS: readonly string[] = [
  ".cybara/memory",
  ".cybara/skills",
  ".cybara/tool-results",
];
const READABLE_CYBARA_IMAGE_SUBDIRS: readonly string[] = [".cybara/screenshots"];
const READABLE_IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

export function assertReadablePath(
  rawPath: string | undefined,
  options?: PathPolicyOptions
): string {
  const decision = checkWritePath(rawPath, options);
  if (!decision.allowed && decision.reason === "sensitive-path" && rawPath) {
    const candidates = policyPaths(rawPath);
    const inReadableSubdir = candidates.every((candidate) =>
      READABLE_CYBARA_SUBDIRS.some((subdir) => isUnderHomeSubdir(candidate, subdir))
    );
    const inReadableImageSubdir =
      READABLE_IMAGE_PATTERN.test(decision.resolvedPath) &&
      candidates.every((candidate) =>
        READABLE_CYBARA_IMAGE_SUBDIRS.some((subdir) => isUnderHomeSubdir(candidate, subdir))
      );
    const hitsFilenameDeny = candidates.some((candidate) => matchesDenyPattern(candidate));
    if ((inReadableSubdir || inReadableImageSubdir) && !hitsFilenameDeny) {
      return decision.resolvedPath;
    }
  }
  if (!decision.allowed) {
    const message =
      decision.reason === "sensitive-path"
        ? "Refused: reading this path is blocked — it points at a sensitive credential or key file."
        : describeDenial(decision.reason!);
    throw new Error(message);
  }
  return decision.resolvedPath;
}
