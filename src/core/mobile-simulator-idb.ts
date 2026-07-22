import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { resolveCybaraHome } from "./cybara-home";

export const IDB_CLIENT_VERSION = "1.1.7";
export const IDB_PYTHON_VERSION = "3.11.14";

export interface IosSimulatorAutomationPaths {
  brew: string | null;
  client: string | null;
  companion: string | null;
  uv: string | null;
}

export interface IosSimulatorAutomationStatus {
  clientInstalled: boolean;
  companionInstalled: boolean;
  installable: boolean;
  installed: boolean;
  installing: boolean;
  reason?: string;
}

interface IdbCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

type IdbCommandRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => Promise<IdbCommandResult>;

interface IdbRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  home?: string;
  platform?: NodeJS.Platform;
  rootDir?: string;
  runner?: IdbCommandRunner;
  which?: (command: string) => string | null;
}

const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
let installation: Promise<IosSimulatorAutomationPaths> | null = null;
let installationError: string | null = null;

function firstExecutable(
  candidates: Array<string | null | undefined>,
  exists: (path: string) => boolean
): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function managedIdbRuntimeDir(rootDir = resolveCybaraHome().dir): string {
  return join(rootDir, "runtime", "idb", IDB_CLIENT_VERSION);
}

function managedIdbClientPath(rootDir: string): string | null {
  const runtimeDir = managedIdbRuntimeDir(rootDir);
  try {
    const expected = `fb-idb=${IDB_CLIENT_VERSION}\npython=${IDB_PYTHON_VERSION}`;
    return readFileSync(join(runtimeDir, ".version"), "utf8").trim() === expected
      ? join(runtimeDir, "bin", "idb")
      : null;
  } catch {
    return null;
  }
}

export function resolveIosSimulatorAutomationPaths(
  options: IdbRuntimeOptions = {}
): IosSimulatorAutomationPaths {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return { brew: null, client: null, companion: null, uv: null };
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const home = options.home ?? homedir();
  const rootDir = options.rootDir ?? resolveCybaraHome().dir;
  const which = options.which ?? ((command: string) => Bun.which(command));
  const resourceDir = env.CYBARA_RESOURCE_DIR?.trim();
  const client = firstExecutable(
    [
      env.CYBARA_IDB_PATH,
      managedIdbClientPath(rootDir),
      resourceDir && join(resourceDir, "idb", "bin", "idb"),
      join(home, ".local", "bin", "idb"),
      "/opt/homebrew/bin/idb",
      "/usr/local/bin/idb",
      which("idb"),
    ],
    exists
  );
  const companion = firstExecutable(
    [
      env.CYBARA_IDB_COMPANION_PATH,
      resourceDir && join(resourceDir, "idb", "bin", "idb_companion"),
      "/opt/homebrew/bin/idb_companion",
      "/usr/local/bin/idb_companion",
      which("idb_companion"),
    ],
    exists
  );
  const brew = firstExecutable(
    [env.CYBARA_BREW_PATH, "/opt/homebrew/bin/brew", "/usr/local/bin/brew", which("brew")],
    exists
  );
  const uv = firstExecutable(
    [
      env.CYBARA_UV_PATH,
      join(home, ".local", "bin", "uv"),
      "/opt/homebrew/bin/uv",
      "/usr/local/bin/uv",
      which("uv"),
    ],
    exists
  );
  return { brew, client, companion, uv };
}

export function getIosSimulatorAutomationStatus(
  options: IdbRuntimeOptions = {}
): IosSimulatorAutomationStatus {
  if ((options.platform ?? process.platform) !== "darwin") {
    return {
      clientInstalled: false,
      companionInstalled: false,
      installable: false,
      installed: false,
      installing: false,
      reason: "iOS Simulator automation requires macOS.",
    };
  }
  const paths = resolveIosSimulatorAutomationPaths(options);
  const installed = paths.client !== null && paths.companion !== null;
  const installable =
    (paths.companion !== null || paths.brew !== null) &&
    (paths.client !== null || paths.uv !== null || paths.brew !== null);
  let reason: string | undefined;
  if (!installed && installationError) reason = installationError;
  else if (!paths.companion && !paths.brew)
    reason = "Homebrew is required to install the iOS simulator automation companion.";
  else if (!paths.client && !paths.uv && !paths.brew)
    reason = "Homebrew or uv is required to install the iOS simulator automation client.";
  return {
    clientInstalled: paths.client !== null,
    companionInstalled: paths.companion !== null,
    installable,
    installed,
    installing: installation !== null,
    ...(reason ? { reason } : {}),
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<IdbCommandResult> {
  const handle = Bun.spawn([command, ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(handle.stdout).text();
  const stderrPromise = new Response(handle.stderr).text();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const exitCode = await Promise.race([
      handle.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("iOS simulator automation installation timed out")),
          INSTALL_TIMEOUT_MS
        );
        timer.unref?.();
      }),
    ]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
  } catch (error) {
    handle.kill();
    await handle.exited.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runInstallerCommand(
  runner: IdbCommandRunner,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const result = await runner(command, args, env);
  if (result.exitCode === 0) return;
  throw new Error(
    result.stderr || result.stdout || `iOS simulator dependency install exited ${result.exitCode}`
  );
}

async function installIosSimulatorAutomation(
  options: IdbRuntimeOptions
): Promise<IosSimulatorAutomationPaths> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") throw new Error("iOS Simulator automation requires macOS");
  const env = options.env ?? process.env;
  const rootDir = options.rootDir ?? resolveCybaraHome().dir;
  const managedDir = managedIdbRuntimeDir(rootDir);
  const runner = options.runner ?? defaultCommandRunner;
  let paths = resolveIosSimulatorAutomationPaths(options);
  if (paths.client && paths.companion) return paths;
  if (!paths.companion) {
    if (!paths.brew)
      throw new Error("Install Homebrew before enabling direct iOS simulator controls");
    await runInstallerCommand(runner, paths.brew, ["tap", "facebook/fb"], env);
    await runInstallerCommand(runner, paths.brew, ["trust", "--tap", "facebook/fb"], env);
    await runInstallerCommand(runner, paths.brew, ["install", "idb-companion"], env);
    paths = resolveIosSimulatorAutomationPaths(options);
  }
  if (!paths.client) {
    if (!paths.uv) {
      if (!paths.brew)
        throw new Error("Install Homebrew or uv before enabling direct iOS simulator controls");
      await runInstallerCommand(runner, paths.brew, ["install", "uv"], env);
      paths = resolveIosSimulatorAutomationPaths(options);
    }
    if (!paths.uv) throw new Error("uv installed but its executable could not be found");
    const binDir = join(managedDir, "bin");
    mkdirSync(binDir, { recursive: true });
    await runInstallerCommand(
      runner,
      paths.uv,
      [
        "tool",
        "install",
        "--force",
        "--managed-python",
        "--python",
        IDB_PYTHON_VERSION,
        `fb-idb==${IDB_CLIENT_VERSION}`,
      ],
      {
        ...env,
        UV_CACHE_DIR: join(managedDir, "cache"),
        UV_PYTHON_INSTALL_DIR: join(managedDir, "python"),
        UV_TOOL_BIN_DIR: binDir,
        UV_TOOL_DIR: join(managedDir, "tools"),
      }
    );
    writeFileSync(
      join(managedDir, ".version"),
      `fb-idb=${IDB_CLIENT_VERSION}\npython=${IDB_PYTHON_VERSION}\n`
    );
    paths = resolveIosSimulatorAutomationPaths(options);
  }
  if (!paths.client || !paths.companion) {
    throw new Error("iOS simulator automation installation completed without both IDB components");
  }
  return paths;
}

export async function ensureIosSimulatorAutomation(
  options: IdbRuntimeOptions = {}
): Promise<IosSimulatorAutomationPaths> {
  const existing = resolveIosSimulatorAutomationPaths(options);
  if (existing.client && existing.companion) {
    installationError = null;
    return existing;
  }
  if (installation) return await installation;
  installationError = null;
  installation = installIosSimulatorAutomation(options);
  try {
    return await installation;
  } catch (error) {
    installationError = error instanceof Error ? error.message : "IDB installation failed";
    throw error;
  } finally {
    installation = null;
  }
}

export function iosSimulatorAutomationEnv(
  paths: IosSimulatorAutomationPaths,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const directories = [paths.client, paths.companion]
    .filter((path): path is string => path !== null)
    .map(dirname);
  return {
    ...env,
    PATH: [...directories, env.PATH || ""].filter(Boolean).join(delimiter),
  };
}
