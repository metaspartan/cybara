import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { config, type SandboxProvider, type SandboxRuntimeConfig } from "./config";
import { createLogger } from "./logger";

const log = createLogger("Sandbox");

export type ResolvedSandboxProvider = "apple_sandbox" | "podman" | "docker";

export interface SandboxProviderResolution {
  enabled: boolean;
  provider: ResolvedSandboxProvider | null;
  reason?: string;
  runtime: SandboxRuntimeConfig;
}

export interface SandboxedShellPlan {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  provider: ResolvedSandboxProvider | null;
  enabled: boolean;
  reason?: string;
}

function commandExists(command: string): boolean {
  try {
    const result = Bun.spawnSync(["sh", "-lc", `command -v ${command} >/dev/null 2>&1`], {
      timeout: 2000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function resolveProviderFromRuntime(runtime: SandboxRuntimeConfig): SandboxProviderResolution {
  if (!runtime.enabled) {
    return { enabled: false, provider: null, runtime };
  }

  const choose = (provider: ResolvedSandboxProvider | null, reason?: string): SandboxProviderResolution => ({
    enabled: true,
    provider,
    reason,
    runtime,
  });

  const checkExplicitProvider = (provider: SandboxProvider): SandboxProviderResolution => {
    if (provider === "apple_sandbox") {
      if (process.platform !== "darwin" || process.arch !== "arm64") {
        return choose(null, "apple sandbox is only supported on Apple Silicon");
      }
      if (!commandExists("sandbox-exec")) {
        return choose(null, "sandbox-exec is not available on this machine");
      }
      return choose("apple_sandbox");
    }

    if (provider === "podman") {
      if (process.platform !== "linux") {
        return choose(null, "podman sandbox is only supported on Linux");
      }
      if (!commandExists("podman")) {
        return choose(null, "podman is not installed");
      }
      return choose("podman");
    }

    if (provider === "docker") {
      if (!commandExists("docker")) {
        return choose(null, "docker is not installed");
      }
      return choose("docker");
    }

    return choose(null, "unknown sandbox provider");
  };

  if (runtime.provider !== "auto") {
    return checkExplicitProvider(runtime.provider);
  }

  if (process.platform === "darwin" && process.arch === "arm64" && commandExists("sandbox-exec")) {
    return choose("apple_sandbox");
  }
  if (process.platform === "linux" && commandExists("podman")) {
    return choose("podman");
  }
  if (commandExists("docker")) {
    return choose("docker");
  }

  return choose(
    null,
    process.platform === "darwin"
      ? "sandbox-exec unavailable; install Xcode command line tools"
      : process.platform === "linux"
        ? "podman/docker unavailable; install podman or docker"
        : `no supported sandbox provider for ${process.platform}/${process.arch}`
  );
}

function escapeSandboxPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeWorkdir(input?: string): string {
  const fallback = process.cwd();
  if (typeof input !== "string" || !input.trim()) return fallback;
  const trimmed = input.trim();
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|\/|\\)/, homedir()));
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(fallback, trimmed);
}

function buildAppleSandboxPolicy(workdir: string, network: SandboxRuntimeConfig["network"]): string {
  const escapedWorkdir = escapeSandboxPath(workdir);
  const networkRule = network === "allow" ? "(allow network*)" : "(deny network*)";
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow file-read*)",
    `(allow file-write* (subpath "${escapedWorkdir}"))`,
    '(allow file-write* (subpath "/private/tmp"))',
    '(allow file-write* (subpath "/tmp"))',
    networkRule,
  ].join(" ");
}

function buildPodmanCommand(
  command: string,
  workdir: string,
  env: Record<string, string | undefined>,
  runtime: SandboxRuntimeConfig
): string[] {
  const args = [
    "run",
    "--rm",
    "--pull=never",
    "--userns=keep-id",
    "--security-opt",
    "no-new-privileges",
    "--network",
    runtime.network === "allow" ? "bridge" : "none",
    "-v",
    `${workdir}:/workspace:Z`,
    "-w",
    "/workspace",
  ];

  for (const [key, value] of Object.entries(env)) {
    if (!key || typeof value !== "string") continue;
    args.push("-e", `${key}=${value}`);
  }

  args.push("docker.io/library/alpine:3.20", "sh", "-lc", command);
  return ["podman", ...args];
}

function buildDockerCommand(
  command: string,
  workdir: string,
  env: Record<string, string | undefined>,
  runtime: SandboxRuntimeConfig
): string[] {
  const args = [
    "run",
    "--rm",
    "--pull=missing",
    "--security-opt",
    "no-new-privileges",
    "--network",
    runtime.network === "allow" ? "bridge" : "none",
    "-v",
    `${workdir}:/workspace`,
    "-w",
    "/workspace",
  ];

  for (const [key, value] of Object.entries(env)) {
    if (!key || typeof value !== "string") continue;
    args.push("-e", `${key}=${value}`);
  }

  args.push("alpine:3.20", "sh", "-lc", command);
  return ["docker", ...args];
}

export function resolveSandboxRuntime(): SandboxProviderResolution {
  const runtime = config.getSandboxRuntime();
  return resolveProviderFromRuntime(runtime);
}

export function buildSandboxedShellPlan(params: {
  command: string;
  workdir?: string;
  env?: Record<string, string | undefined>;
}): SandboxedShellPlan {
  const workdir = normalizeWorkdir(params.workdir);
  const env = params.env || {};
  const resolution = resolveSandboxRuntime();

  if (!resolution.enabled) {
    log.debug("Sandbox disabled; using host shell", { reason: "sandbox disabled", cwd: workdir });
    return {
      command: ["sh", "-c", params.command],
      cwd: workdir,
      env,
      provider: null,
      enabled: false,
      reason: "sandbox disabled",
    };
  }

  if (!resolution.provider) {
    log.warn("Sandbox enabled but no provider available", {
      reason: resolution.reason,
      configuredProvider: resolution.runtime.provider,
      network: resolution.runtime.network,
    });
    throw new Error(
      `Sandbox mode is enabled but unavailable: ${resolution.reason || "missing runtime provider"}`
    );
  }

  if (resolution.provider === "apple_sandbox") {
    const policy = buildAppleSandboxPolicy(workdir, resolution.runtime.network);
    log.info("Prepared sandbox command", {
      provider: "apple_sandbox",
      cwd: workdir,
      network: resolution.runtime.network,
    });
    return {
      command: ["sandbox-exec", "-p", policy, "sh", "-lc", params.command],
      cwd: workdir,
      env,
      provider: "apple_sandbox",
      enabled: true,
    };
  }

  if (resolution.provider === "docker") {
    const dockerCommand = buildDockerCommand(
      params.command,
      workdir,
      env,
      resolution.runtime
    );
    log.info("Prepared sandbox command", {
      provider: "docker",
      cwd: workdir,
      network: resolution.runtime.network,
    });
    return {
      command: dockerCommand,
      cwd: workdir,
      env,
      provider: "docker",
      enabled: true,
    };
  }

  log.info("Prepared sandbox command", {
    provider: "podman",
    cwd: workdir,
    network: resolution.runtime.network,
  });
  return {
    command: buildPodmanCommand(params.command, workdir, env, resolution.runtime),
    cwd: workdir,
    env,
    provider: "podman",
    enabled: true,
  };
}

export function getSandboxPromptInfo(workspaceDir?: string): {
  enabled: boolean;
  workspaceDir?: string;
  workspaceAccess?: "none" | "ro" | "rw";
  hostBrowserAllowed?: boolean;
} {
  const resolution = resolveSandboxRuntime();
  if (!resolution.enabled || !resolution.provider) {
    return { enabled: false };
  }

  return {
    enabled: true,
    workspaceDir,
    workspaceAccess: "rw",
    hostBrowserAllowed: false,
  };
}
