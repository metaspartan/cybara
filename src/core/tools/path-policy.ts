import { lstatSync, realpathSync } from "fs";
import { homedir } from "os";
import { resolve, isAbsolute, dirname, join } from "path";
import { runtimeHomeDir } from "../cybara-home";
import { cybaraDir } from "../paths";

export type PathPolicyDenialReason =
  | "sensitive-path"
  | "outside-workspace"
  | "empty-path"
  | "unresolved-path";

export type SensitiveReadMode = "blocked" | "env-files" | "all";

export interface PathPolicyDecision {
  allowed: boolean;
  reason?: PathPolicyDenialReason;
  resolvedPath: string;
}

const ENV_FILE_PATTERN = /^\.env(\..*)?$/i;
const ENV_TEMPLATE_PATTERN = /^\.env(\..*)?\.(example|sample|template|dist)$/i;

const DENY_FILENAME_PATTERNS: readonly RegExp[] = [
  ENV_FILE_PATTERN,
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
  "Library/Cookies",
  "Library/Keychains",
];

export interface PathPolicyOptions {
  confineToWorkspace?: boolean;
  workspaceRoot?: string;
  extraDenyPrefixes?: string[];
  disabled?: boolean;
  sensitiveReads?: SensitiveReadMode;
}

function normalize(p: string): string {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}

function resolvePath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

function realPolicyPath(p: string): string | undefined {
  const absolute = resolve(p);
  let candidate = absolute;
  while (true) {
    try {
      const real = realpathSync.native(candidate);
      const suffix = absolute.slice(candidate.length).replace(/^[\\/]+/, "");
      return suffix ? join(real, suffix) : real;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      try {
        lstatSync(candidate);
        return undefined;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return undefined;
      candidate = parent;
    }
  }
}

function policyPaths(rawPath: string): string[] | undefined {
  const real = realPolicyPath(rawPath);
  if (!real) return undefined;
  return [...new Set([normalize(rawPath), normalize(real)])];
}

function basenameOf(resolvedPath: string): string {
  return resolvedPath.toLowerCase().split("/").pop() ?? "";
}

export function isEnvTemplateFile(path: string): boolean {
  return ENV_TEMPLATE_PATTERN.test(basenameOf(path.replace(/\\/g, "/")));
}

export function isEnvFile(path: string): boolean {
  const basename = basenameOf(path.replace(/\\/g, "/"));
  return ENV_FILE_PATTERN.test(basename) && !ENV_TEMPLATE_PATTERN.test(basename);
}

function matchesDenyPattern(resolvedPath: string): boolean {
  const lower = resolvedPath.toLowerCase();
  const basename = basenameOf(lower);
  if (ENV_TEMPLATE_PATTERN.test(basename)) return false;
  for (const pattern of DENY_FILENAME_PATTERNS) {
    if (pattern.source.includes("\\/") || pattern.source.includes("/")) {
      if (pattern.test(lower) || pattern.test(resolvedPath)) return true;
    } else if (pattern.test(basename)) {
      return true;
    }
  }
  return false;
}

function withRealPaths(paths: string[]): string[] {
  const roots: string[] = [];
  for (const path of paths) {
    const normalized = normalize(path);
    if (!roots.includes(normalized)) roots.push(normalized);
    try {
      const real = normalize(realpathSync.native(path));
      if (!roots.includes(real)) roots.push(real);
    } catch {
      continue;
    }
  }
  return roots;
}

function homePolicyRoots(): string[] {
  return withRealPaths([homedir(), runtimeHomeDir]);
}

function cybaraPolicyRoots(): string[] {
  return withRealPaths([join(homedir(), ".cybara"), join(runtimeHomeDir, ".cybara"), cybaraDir]);
}

function isUnderCybaraDir(resolvedPath: string, subdir?: string): boolean {
  return cybaraPolicyRoots().some((root) => {
    const marker = subdir ? `${root}/${subdir.toLowerCase()}` : root;
    return resolvedPath === marker || resolvedPath.startsWith(`${marker}/`);
  });
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
  if (!candidates) {
    return {
      allowed: false,
      reason: "unresolved-path",
      resolvedPath: resolved,
    };
  }

  if (options.confineToWorkspace) {
    if (!options.workspaceRoot) {
      return {
        allowed: false,
        reason: "outside-workspace",
        resolvedPath: resolved,
      };
    }
    const workspacePaths = policyPaths(options.workspaceRoot);
    if (!workspacePaths) {
      return {
        allowed: false,
        reason: "unresolved-path",
        resolvedPath: resolved,
      };
    }
    const roots = workspacePaths.map((root) => root.replace(/\/$/, ""));
    if (roots.some((root) => !isAbsolute(root))) {
      return {
        allowed: false,
        reason: "outside-workspace",
        resolvedPath: resolved,
      };
    }
    for (const candidate of candidates) {
      const underWorkspace = roots.some(
        (root) => candidate === root || candidate.startsWith(`${root}/`)
      );
      if (!underWorkspace) {
        return {
          allowed: false,
          reason: "outside-workspace",
          resolvedPath: resolved,
        };
      }
    }
  }

  for (const candidate of candidates) {
    if (matchesDenyPattern(candidate)) {
      return {
        allowed: false,
        reason: "sensitive-path",
        resolvedPath: resolved,
      };
    }

    if (isUnderCybaraDir(candidate)) {
      return {
        allowed: false,
        reason: "sensitive-path",
        resolvedPath: resolved,
      };
    }

    for (const segment of DENY_PATH_SEGMENTS) {
      if (isUnderHomeSubdir(candidate, segment)) {
        return {
          allowed: false,
          reason: "sensitive-path",
          resolvedPath: resolved,
        };
      }
    }

    for (const prefix of options.extraDenyPrefixes ?? []) {
      const prefixCandidates = policyPaths(prefix);
      if (!prefixCandidates) {
        return {
          allowed: false,
          reason: "unresolved-path",
          resolvedPath: resolved,
        };
      }
      if (
        prefixCandidates.some(
          (normalizedPrefix) =>
            candidate === normalizedPrefix || candidate.startsWith(`${normalizedPrefix}/`)
        )
      ) {
        return {
          allowed: false,
          reason: "sensitive-path",
          resolvedPath: resolved,
        };
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
    case "unresolved-path":
      return "Refused: the path could not be safely resolved by the filesystem.";
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

const READABLE_CYBARA_SUBDIRS: readonly string[] = ["memory", "skills", "tool-results"];
const READABLE_CYBARA_IMAGE_SUBDIRS: readonly string[] = ["screenshots"];
const READABLE_IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

export const SENSITIVE_READ_DENIAL =
  "Refused: reading this path is blocked — it points at a sensitive credential or key file. If this is intended, allow sensitive file reads under Settings → Safety → Sensitive file access.";

function permittedBySensitiveReadMode(
  candidates: string[],
  mode: SensitiveReadMode | undefined
): boolean {
  if (!mode || mode === "blocked") return false;
  if (candidates.some((candidate) => isUnderCybaraDir(candidate))) return false;
  if (mode === "all") return true;
  return candidates.every((candidate) => isEnvFile(candidate));
}

export function assertReadablePath(
  rawPath: string | undefined,
  options?: PathPolicyOptions
): string {
  const decision = checkWritePath(rawPath, options);
  if (!decision.allowed && decision.reason === "sensitive-path" && rawPath) {
    const candidates = policyPaths(rawPath);
    if (!candidates) throw new Error(describeDenial("unresolved-path"));
    if (permittedBySensitiveReadMode(candidates, options?.sensitiveReads)) {
      return decision.resolvedPath;
    }
    const inReadableSubdir = candidates.every((candidate) =>
      READABLE_CYBARA_SUBDIRS.some((subdir) => isUnderCybaraDir(candidate, subdir))
    );
    const inReadableImageSubdir =
      READABLE_IMAGE_PATTERN.test(decision.resolvedPath) &&
      candidates.every((candidate) =>
        READABLE_CYBARA_IMAGE_SUBDIRS.some((subdir) => isUnderCybaraDir(candidate, subdir))
      );
    const hitsFilenameDeny = candidates.some((candidate) => matchesDenyPattern(candidate));
    if ((inReadableSubdir || inReadableImageSubdir) && !hitsFilenameDeny) {
      return decision.resolvedPath;
    }
  }
  if (!decision.allowed) {
    const message =
      decision.reason === "sensitive-path"
        ? SENSITIVE_READ_DENIAL
        : describeDenial(decision.reason!);
    throw new Error(message);
  }
  return decision.resolvedPath;
}
