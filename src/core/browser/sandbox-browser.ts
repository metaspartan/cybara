import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readSubprocessStreamAsText } from "../subprocess-output";

export const SANDBOX_BROWSER_IMAGE = "cybara-sandbox-browser:bookworm-slim";
export const SANDBOX_BROWSER_CONTAINER = "cybara-sandbox-browser";
export const DEFAULT_SANDBOX_CDP_PORT = 9222;
export const DEFAULT_SANDBOX_NOVNC_PORT = 6080;

const DOCKER_CMD = process.env.CYBARA_SANDBOX_DOCKER_CMD || "docker";

export interface SandboxBrowserOptions {
  image?: string;
  container?: string;
  cdpPort?: number;
  novncPort?: number;
}

export interface SandboxBrowserStatus {
  dockerAvailable: boolean;
  imageBuilt: boolean;
  running: boolean;
  cdpPort: number;
  novncPort: number;
  cdpUrl: string;
  novncUrl: string;
  reason?: string;
}

export interface SandboxContextPaths {
  cwd?: string;
  execDir?: string;
  moduleDir?: string;
  resourceDir?: string;
  configuredDir?: string;
}

function resolved(opts?: SandboxBrowserOptions) {
  return {
    image: opts?.image || SANDBOX_BROWSER_IMAGE,
    container: opts?.container || SANDBOX_BROWSER_CONTAINER,
    cdpPort: opts?.cdpPort ?? DEFAULT_SANDBOX_CDP_PORT,
    novncPort: opts?.novncPort ?? DEFAULT_SANDBOX_NOVNC_PORT,
  };
}

export function sandboxCdpUrl(cdpPort: number = DEFAULT_SANDBOX_CDP_PORT): string {
  return `http://127.0.0.1:${cdpPort}`;
}

export function sandboxNovncUrl(novncPort: number = DEFAULT_SANDBOX_NOVNC_PORT): string {
  return `http://127.0.0.1:${novncPort}/vnc.html?autoconnect=1&resize=scale`;
}

export function buildDockerRunArgs(opts: {
  image: string;
  container: string;
  cdpPort: number;
  novncPort: number;
}): string[] {
  return [
    "run",
    "-d",
    "--rm",
    "--name",
    opts.container,
    "--shm-size=1g",
    "-p",
    `127.0.0.1:${opts.cdpPort}:9222`,
    "-p",
    `127.0.0.1:${opts.novncPort}:6080`,
    opts.image,
  ];
}

export function resolveSandboxContextDir(paths: SandboxContextPaths = {}): string {
  const moduleDir = paths.moduleDir || dirname(fileURLToPath(import.meta.url));
  const cwd = paths.cwd || process.cwd();
  const execDir = paths.execDir || dirname(process.execPath);
  const resourceDir = paths.resourceDir || process.env.CYBARA_RESOURCE_DIR?.trim();
  const configuredDir = paths.configuredDir || process.env.CYBARA_SANDBOX_BROWSER_DIR?.trim();
  const candidates = [
    configuredDir,
    resourceDir && join(resourceDir, "docker", "sandbox-browser"),
    resourceDir && join(resourceDir, "bin", "docker", "sandbox-browser"),
    join(cwd, "docker", "sandbox-browser"),
    join(moduleDir, "..", "docker", "sandbox-browser"),
    join(moduleDir, "..", "..", "..", "docker", "sandbox-browser"),
    join(execDir, "docker", "sandbox-browser"),
    join(execDir, "..", "docker", "sandbox-browser"),
    join(execDir, "resources", "bin", "docker", "sandbox-browser"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const resolved = candidates.find((candidate) => existsSync(join(candidate, "Dockerfile")));
  return resolved || candidates[0];
}

export function sandboxContextDir(): string {
  return resolveSandboxContextDir();
}

function dockerAvailable(): boolean {
  try {
    const result = Bun.spawnSync([DOCKER_CMD, "version", "--format", "{{.Server.Version}}"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function imageBuilt(image: string): boolean {
  const result = Bun.spawnSync([DOCKER_CMD, "image", "inspect", image], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

function containerRunning(container: string): boolean {
  const result = Bun.spawnSync([DOCKER_CMD, "inspect", "-f", "{{.State.Running}}", container], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 && result.stdout.toString().trim() === "true";
}

async function waitForCdp(cdpPort: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const url = `${sandboxCdpUrl(cdpPort)}/json/version`;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      void 0;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function buildSandboxImage(opts?: SandboxBrowserOptions): Promise<void> {
  const { image } = resolved(opts);
  const context = sandboxContextDir();
  if (!existsSync(join(context, "Dockerfile"))) {
    throw new Error(`Sandbox browser Dockerfile not found at ${context}`);
  }
  const proc = Bun.spawn([DOCKER_CMD, "build", "-t", image, context], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await readSubprocessStreamAsText(proc.stderr);
    throw new Error(`Failed to build sandbox browser image: ${err.trim() || `exit ${code}`}`);
  }
}

export function getSandboxBrowserStatus(opts?: SandboxBrowserOptions): SandboxBrowserStatus {
  const { image, container, cdpPort, novncPort } = resolved(opts);
  const base: SandboxBrowserStatus = {
    dockerAvailable: false,
    imageBuilt: false,
    running: false,
    cdpPort,
    novncPort,
    cdpUrl: sandboxCdpUrl(cdpPort),
    novncUrl: sandboxNovncUrl(novncPort),
  };
  if (!dockerAvailable()) {
    return { ...base, reason: "Docker is not available on this host" };
  }
  return {
    ...base,
    dockerAvailable: true,
    imageBuilt: imageBuilt(image),
    running: containerRunning(container),
  };
}

export async function startSandboxBrowser(
  opts?: SandboxBrowserOptions
): Promise<SandboxBrowserStatus> {
  const params = resolved(opts);
  if (!dockerAvailable()) {
    throw new Error("Docker is not available. Install Docker to use the sandbox browser.");
  }
  if (containerRunning(params.container)) {
    return getSandboxBrowserStatus(opts);
  }
  if (!imageBuilt(params.image)) {
    await buildSandboxImage(opts);
  }
  const proc = Bun.spawn([DOCKER_CMD, ...buildDockerRunArgs(params)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await readSubprocessStreamAsText(proc.stderr);
    throw new Error(`Failed to start sandbox browser: ${err.trim() || `exit ${code}`}`);
  }
  const ready = await waitForCdp(params.cdpPort, 30_000);
  if (!ready) {
    throw new Error("Sandbox browser started but CDP did not become ready within 30s");
  }
  return getSandboxBrowserStatus(opts);
}

export async function stopSandboxBrowser(opts?: SandboxBrowserOptions): Promise<void> {
  const { container } = resolved(opts);
  if (!dockerAvailable()) return;
  const proc = Bun.spawn([DOCKER_CMD, "rm", "-f", container], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}
