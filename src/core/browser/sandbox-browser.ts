import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readSubprocessStreamAsText } from "../subprocess-output";

export const SANDBOX_BROWSER_IMAGE = "cybara-sandbox-browser:bookworm-slim";
export const SANDBOX_BROWSER_CONTAINER = "cybara-sandbox-browser";
export const DEFAULT_SANDBOX_CDP_PORT = 9222;
export const DEFAULT_SANDBOX_NOVNC_PORT = 6080;

const DOCKER_CMD = process.env.CYBARA_SANDBOX_DOCKER_CMD || "docker";
const DOCKER_PROBE_TIMEOUT_MS = 4000;
const DOCKER_UNAVAILABLE_CACHE_MS = 15_000;

let dockerUnavailableUntil = 0;

function dockerCommand(): string {
  return process.env.CYBARA_SANDBOX_DOCKER_CMD || DOCKER_CMD;
}

function dockerProbeTimeoutMs(): number {
  const configured = Number(process.env.CYBARA_SANDBOX_DOCKER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DOCKER_PROBE_TIMEOUT_MS;
}

interface DockerProbeResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
}

async function runDockerProbe(args: string[]): Promise<DockerProbeResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([dockerCommand(), ...args], { stdout: "pipe", stderr: "pipe" });
  } catch {
    return { exitCode: null, stdout: "", timedOut: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout("timeout"), dockerProbeTimeoutMs());
  });
  const outcome = await Promise.race([proc.exited, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") {
    proc.kill("SIGKILL");
    return { exitCode: null, stdout: "", timedOut: true };
  }
  const stdout =
    proc.stdout instanceof ReadableStream ? await readSubprocessStreamAsText(proc.stdout) : "";
  return { exitCode: outcome, stdout, timedOut: false };
}

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

async function dockerAvailable(): Promise<boolean> {
  if (Date.now() < dockerUnavailableUntil) return false;
  const result = await runDockerProbe(["version", "--format", "{{.Server.Version}}"]);
  const available = result.exitCode === 0;
  dockerUnavailableUntil = available ? 0 : Date.now() + DOCKER_UNAVAILABLE_CACHE_MS;
  return available;
}

async function imageBuilt(image: string): Promise<boolean> {
  return (await runDockerProbe(["image", "inspect", image])).exitCode === 0;
}

async function containerRunning(container: string): Promise<boolean> {
  const result = await runDockerProbe(["inspect", "-f", "{{.State.Running}}", container]);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export function resetSandboxDockerAvailabilityForTests(): void {
  dockerUnavailableUntil = 0;
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
  const proc = Bun.spawn([dockerCommand(), "build", "-t", image, context], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await readSubprocessStreamAsText(proc.stderr);
    throw new Error(`Failed to build sandbox browser image: ${err.trim() || `exit ${code}`}`);
  }
}

export async function getSandboxBrowserStatus(
  opts?: SandboxBrowserOptions
): Promise<SandboxBrowserStatus> {
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
  if (!(await dockerAvailable())) {
    return { ...base, reason: "Docker is not available on this host" };
  }
  return {
    ...base,
    dockerAvailable: true,
    imageBuilt: await imageBuilt(image),
    running: await containerRunning(container),
  };
}

export async function startSandboxBrowser(
  opts?: SandboxBrowserOptions
): Promise<SandboxBrowserStatus> {
  const params = resolved(opts);
  if (!(await dockerAvailable())) {
    throw new Error("Docker is not available. Install Docker to use the sandbox browser.");
  }
  if (await containerRunning(params.container)) {
    return getSandboxBrowserStatus(opts);
  }
  if (!(await imageBuilt(params.image))) {
    await buildSandboxImage(opts);
  }
  const proc = Bun.spawn([dockerCommand(), ...buildDockerRunArgs(params)], {
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
  if (!(await dockerAvailable())) return;
  const proc = Bun.spawn([dockerCommand(), "rm", "-f", container], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}
