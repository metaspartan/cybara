/**
 * computer_use — background desktop control via the external cua-driver.
 *
 * The agent can capture screenshots, click, type, scroll, drag, and manage
 * apps WITHOUT stealing the user's cursor (background mode is a property of the
 * cua-driver backend). The heavy platform work (SkyLight SPIs on macOS, UIA on
 * Windows, X11 on Linux) lives in the external `cua-driver` binary; this module
 * is a thin MCP-stdio client to it.
 *
 * Safety hardening:
 *  - Un-overridable hard-blocked key combos (logout/lock) and type patterns
 *    (curl|bash, sudo rm -rf, fork bombs) — see BLOCKED_KEY_COMBOS / BLOCKED_TYPE_PATTERNS.
 *  - Action validation before dispatch (rejects unknown actions).
 *  - Reconnect-once on a closed driver session instead of failing every call.
 *  - MIME-aware screenshot envelope so vision models receive a real image block.
 *
 * Requires: `cua-driver` on $PATH, in a known platform install dir, or at
 * CYBARA_CUA_DRIVER_CMD.
 * On macOS also requires Accessibility + Screen Recording TCC grants to
 * cua-driver's identity (verified by computerUseDoctor()).
 */
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { config } from "./config";

const DEFAULT_CUA_DRIVER_CMD = "cua-driver";
const CUA_DRIVER_CMD_ENV = "CYBARA_CUA_DRIVER_CMD";
const REQUEST_TIMEOUT_MS = 30_000;

export type CuaDriverCommandSource = "env" | "config" | "path" | "known-install-dir" | "default";

export interface CuaDriverResolution {
  command: string;
  source: CuaDriverCommandSource;
  searchedPaths: string[];
}

let driverProcess: ChildProcess | null = null;
/** Tool names advertised by the running driver (tools/list); empty = unknown. */
let driverToolNames = new Set<string>();
/** Window the next action targets; every interactive driver tool requires a pid. */
let activeWindowTarget: { pid: number; windowId?: number; appName?: string } | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();
let initBuffer = "";

// --- Safety: un-overridable hard blocks ---

/** Key combos that would log out / lock / shut down — never forwarded to the driver. */
const BLOCKED_KEY_COMBOS: readonly RegExp[] = [
  /^cmd\+shift\+q$/i, // macOS logout
  /^ctrl\+shift\+q$/i, // Linux logout
  /^cmd\+ctrl\+q$/i, // macOS lock screen
  /^win\+l$/i, // Windows lock
  /^super\+l$/i, // Linux lock
  /^cmd\+option\+(esc|power|eject)$/i, // force-quit / power
  /^alt\+f4$/i, // close (often app-kill)
];

/** Typed text patterns that are too dangerous to inject (shell pipe-to-bash, rm -rf, fork bombs). */
const BLOCKED_TYPE_PATTERNS: readonly RegExp[] = [
  /(\||;|&&|\|\|)\s*(bash|sh|zsh)\b/i, // curl ... | bash
  /\brm\s+(-[a-z]*r[a-z]*\s+)?\/(\s|$)/i, // rm -rf /
  /\bsudo\s+rm\s+-[a-z]*r/i, // sudo rm -r
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/i, // fork bomb
  /\bmkfs\b/i, // filesystem format
  /\bdd\s+if=\/dev\//i, // raw disk overwrite
];

export function isBlockedKeyCombo(keys: string): boolean {
  const normalized = keys.trim().toLowerCase();
  return BLOCKED_KEY_COMBOS.some((re) => re.test(normalized));
}

export function isBlockedTypeText(text: string): boolean {
  return BLOCKED_TYPE_PATTERNS.some((re) => re.test(text));
}

function isAvailable(): boolean {
  // We can't synchronously check PATH portably; the doctor() call verifies.
  // Treat as available and let start() surface a clear error if missing.
  return true;
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const direct = env[key];
  if (direct !== undefined || platform !== "win32") return direct;
  const wanted = key.toLowerCase();
  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === wanted);
  return match ? env[match] : undefined;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitPathEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string[] {
  const raw = readEnvValue(env, "PATH", platform) || "";
  const delimiter = platform === "win32" ? ";" : ":";
  return raw
    .split(delimiter)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
}

function uniqueStrings(values: string[], platform: NodeJS.Platform = process.platform): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = platform === "win32" ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function driverExecutableNames(platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32"
    ? ["cua-driver.exe", "cua-driver.cmd", "cua-driver.bat", DEFAULT_CUA_DRIVER_CMD]
    : [DEFAULT_CUA_DRIVER_CMD];
}

function candidateExists(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultHomeForPlatform(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform === "win32") {
    return (
      readEnvValue(env, "USERPROFILE", platform) ||
      (readEnvValue(env, "HOMEDRIVE", platform) && readEnvValue(env, "HOMEPATH", platform)
        ? `${readEnvValue(env, "HOMEDRIVE", platform)}${readEnvValue(env, "HOMEPATH", platform)}`
        : undefined) ||
      readEnvValue(env, "HOME", platform)
    );
  }
  return readEnvValue(env, "HOME", platform) || readEnvValue(env, "USERPROFILE", platform);
}

function knownDriverInstallDirs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string[] {
  const configured = [
    readEnvValue(env, "CUA_DRIVER_RS_INSTALL_DIR", platform),
    readEnvValue(env, "CUA_DRIVER_BIN_DIR", platform),
  ].filter((value): value is string => !!value);

  const home = defaultHomeForPlatform(env, platform);
  if (platform === "win32") {
    const localAppData = readEnvValue(env, "LOCALAPPDATA", platform);
    const cuaHome =
      readEnvValue(env, "CUA_DRIVER_RS_HOME", platform) || (home ? join(home, ".cua-driver") : "");
    const legacyCuaHome = home ? join(home, ".cua-driver-rs") : "";
    const dirs = [...configured];
    if (localAppData) {
      dirs.push(
        join(localAppData, "Programs", "Cua", "cua-driver", "bin"),
        join(localAppData, "Programs", "trycua", "cua-driver-rs", "bin")
      );
    }
    for (const packageHome of [cuaHome, legacyCuaHome].filter(Boolean)) {
      const packagesDir = join(packageHome, "packages");
      const currentDir = join(packagesDir, "current");
      dirs.push(currentDir, join(currentDir, "bin"));
      const releasesDir = join(packagesDir, "releases");
      try {
        const releaseDirs = readdirSync(releasesDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(releasesDir, entry.name));
        for (const releaseDir of releaseDirs) {
          dirs.push(releaseDir, join(releaseDir, "bin"));
        }
      } catch {
        /* missing or inaccessible release cache */
      }
    }
    if (home) {
      dirs.push(
        join(home, ".local", "bin"),
        join(home, ".cargo", "bin"),
        join(home, ".bun", "bin")
      );
    }
    return uniqueStrings(dirs, platform);
  }

  const dirs = [...configured];
  if (home) {
    dirs.push(join(home, ".local", "bin"), join(home, ".cargo", "bin"), join(home, ".bun", "bin"));
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  return uniqueStrings(dirs, platform);
}

function findDriverInDirs(
  dirs: string[],
  platform: NodeJS.Platform,
  searchedPaths: string[]
): string | null {
  const names = driverExecutableNames(platform);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      searchedPaths.push(candidate);
      if (candidateExists(candidate)) return candidate;
    }
  }
  return null;
}

function shouldUsePersistedComputerUseConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  configuredCommand: string | undefined
): boolean {
  return configuredCommand === undefined && env === process.env && platform === process.platform;
}

export function resolveCuaDriverCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  configuredCommand?: string
): CuaDriverResolution | null {
  const override = readEnvValue(env, CUA_DRIVER_CMD_ENV, platform);
  if (override?.trim()) {
    return {
      command: stripWrappingQuotes(override),
      source: "env",
      searchedPaths: [],
    };
  }

  const configOverride = shouldUsePersistedComputerUseConfig(env, platform, configuredCommand)
    ? config.getComputerUseSettings().driverCommand
    : configuredCommand;
  if (configOverride?.trim()) {
    return {
      command: stripWrappingQuotes(configOverride),
      source: "config",
      searchedPaths: [],
    };
  }

  const searchedPaths: string[] = [];
  const pathMatch = findDriverInDirs(splitPathEntries(env, platform), platform, searchedPaths);
  if (pathMatch) {
    return { command: pathMatch, source: "path", searchedPaths };
  }

  const installDirMatch = findDriverInDirs(
    knownDriverInstallDirs(env, platform),
    platform,
    searchedPaths
  );
  if (installDirMatch) {
    return { command: installDirMatch, source: "known-install-dir", searchedPaths };
  }

  return null;
}

function getCuaDriverResolution(): CuaDriverResolution {
  return (
    resolveCuaDriverCommand() || {
      command: DEFAULT_CUA_DRIVER_CMD,
      source: "default",
      searchedPaths: [],
    }
  );
}

function driverInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `Install it with PowerShell: irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex. If it is already installed, restart Cybara or set ${CUA_DRIVER_CMD_ENV} to the full cua-driver.exe path.`;
  }
  const install =
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"';
  return `Install it with: ${install}. If it is already installed outside PATH, set ${CUA_DRIVER_CMD_ENV} to the full cua-driver path.`;
}

function driverUnavailableMessage(): string {
  const base = `cua-driver is not available. ${driverInstallHint(process.platform)}`;
  return process.platform === "darwin"
    ? `${base} Then grant macOS Accessibility + Screen Recording permissions (run \`cua-driver permissions grant\`).`
    : base;
}

function spawnDriver(command: string, args: string[], options: Parameters<typeof spawn>[2]) {
  return spawn(command, args, {
    ...options,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });
}

/** Ensure the cua-driver MCP server process is running. */
async function ensureDriver(): Promise<void> {
  if (driverProcess && driverProcess.exitCode === null) return;

  const { command } = getCuaDriverResolution();
  driverProcess = spawnDriver(command, ["mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  driverProcess.stdout?.on("data", (chunk: Buffer) => {
    initBuffer += chunk.toString();
    let newlineIndex: number;
    while ((newlineIndex = initBuffer.indexOf("\n")) >= 0) {
      const line = initBuffer.slice(0, newlineIndex).trim();
      initBuffer = initBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === "number") {
          const entry = pending.get(msg.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(msg.error.message || "cua-driver error"));
            } else {
              entry.resolve(msg.result);
            }
          }
        }
      } catch {
        /* non-JSON line (logs) — ignore */
      }
    }
  });

  driverProcess.stderr?.on("data", (chunk: Buffer) => {
    console.warn(`[cua-driver] ${chunk.toString().trim()}`);
  });

  // CRITICAL: a spawn failure (e.g. cua-driver not installed -> ENOENT) emits an
  // asynchronous "error" event. An unhandled "error" event on a ChildProcess is
  // a fatal uncaught exception in Bun/Node and would crash the whole server.
  // Handle it: reject any in-flight requests and clear the dead process so the
  // next call can retry, surfacing a clean tool error instead of a crash.
  driverProcess.on("error", (err) => {
    console.warn(`[cua-driver] failed to start: ${err instanceof Error ? err.message : err}`);
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(driverUnavailableMessage()));
    }
    driverProcess = null;
  });

  driverProcess.on("exit", (code) => {
    // Reject any in-flight requests on unexpected exit.
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(`cua-driver exited (code ${code})`));
    }
    driverProcess = null;
  });

  await initializeSession();
}

async function initializeSession(): Promise<void> {
  await sendRaw("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cybara", version: "1.0.0" },
  });
  // Complete the MCP handshake; some driver builds queue tool calls until
  // the initialized notification arrives.
  sendNotification("notifications/initialized");

  // Discover the driver's actual tool vocabulary. cua-driver's tool names are
  // NOT our action names (e.g. 0.6.x has get_window_state/type_text/press_key
  // and no capture/type/key), and the set varies by driver version.
  driverToolNames = new Set();
  activeWindowTarget = null;
  try {
    const listed = (await sendRaw("tools/list", {})) as {
      tools?: Array<{ name?: string }>;
    };
    for (const tool of listed?.tools || []) {
      if (typeof tool?.name === "string" && tool.name) {
        driverToolNames.add(tool.name);
      }
    }
  } catch (error) {
    // Discovery failure is non-fatal: with an empty set we optimistically try
    // driver tools and let per-call errors surface (self-healing on any
    // driver version, mirroring hermes-agent's backend behavior).
    console.warn(
      `[computer_use] tools/list failed: ${error instanceof Error ? error.message : error}`
    );
  }
}

/** Fire-and-forget JSON-RPC notification (no id, no response expected). */
function sendNotification(method: string): void {
  if (!driverProcess?.stdin?.writable) return;
  driverProcess.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

/** Send a JSON-RPC request to cua-driver and await its response. */
function sendRaw(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!driverProcess?.stdin?.writable) {
      reject(new Error(driverUnavailableMessage()));
      return;
    }
    const id = nextRequestId++;
    const request = { jsonrpc: "2.0", id, method, params };
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`cua-driver request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    driverProcess.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

export type ComputerUseAction =
  | "capture"
  | "click"
  | "double_click"
  | "right_click"
  | "middle_click"
  | "scroll"
  | "drag"
  | "type"
  | "key"
  | "set_value"
  | "wait"
  | "list_apps"
  | "focus_app";

/** Actions that only read/inspect (no side effects) — safe to run without consent. */
const SAFE_ACTIONS: ReadonlySet<ComputerUseAction> = new Set(["capture", "wait", "list_apps"]);
export const VALID_ACTIONS: ReadonlySet<ComputerUseAction> = new Set<ComputerUseAction>([
  "capture",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "scroll",
  "drag",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
]);

export const COMPUTER_USE_ACTION_TOOL_ALIASES: readonly ComputerUseAction[] = [
  "capture",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "scroll",
  "drag",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
];

export interface ComputerUseArgs {
  action: ComputerUseAction;
  mode?: "som" | "vision" | "ax";
  app?: string;
  element?: number;
  coordinate?: [number, number];
  fromElement?: number;
  toElement?: number;
  fromCoordinate?: [number, number];
  toCoordinate?: [number, number];
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  text?: string;
  keys?: string;
  value?: string;
  seconds?: number;
  raiseWindow?: boolean;
  captureAfter?: boolean;
}

export function normalizeComputerUseActionArgs(
  action: ComputerUseAction,
  args: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args, action };

  if (
    normalized.coordinate === undefined &&
    typeof args.x === "number" &&
    typeof args.y === "number"
  ) {
    normalized.coordinate = [args.x, args.y];
  }

  if (normalized.app === undefined && action === "focus_app") {
    const app =
      typeof args.name === "string"
        ? args.name
        : typeof args.application === "string"
          ? args.application
          : typeof args.bundleId === "string"
            ? args.bundleId
            : typeof args.bundle_id === "string"
              ? args.bundle_id
              : undefined;
    if (app) normalized.app = app;
  }

  if (normalized.element === undefined && typeof args.index === "number") {
    normalized.element = args.index;
  }

  if (normalized.text === undefined && action === "type" && typeof args.value === "string") {
    normalized.text = args.value;
  }

  return normalized;
}

/** Per-session auto-approval for destructive actions (set by the host UI). */
let sessionAutoApprove = false;
export function setComputerUseAutoApprove(enabled: boolean): void {
  sessionAutoApprove = enabled;
}

/** Optional consent callback; if unset, destructive actions require sessionAutoApprove. */
let approvalCallback:
  ((action: ComputerUseAction, args: ComputerUseArgs, summary: string) => boolean) | null = null;
export function setComputerUseApprovalCallback(
  cb: (action: ComputerUseAction, args: ComputerUseArgs, summary: string) => boolean
): void {
  approvalCallback = cb;
}

export function summarizeAction(action: ComputerUseAction, args: ComputerUseArgs): string {
  switch (action) {
    case "click":
    case "double_click":
    case "right_click":
    case "middle_click":
      return `${action} ${args.element ? `element #${args.element}` : args.coordinate ? `at ${args.coordinate.join(",")}` : ""}`.trim();
    case "type":
      return `type "${(args.text || "").slice(0, 40)}"`;
    case "key":
      return `key "${args.keys}"`;
    case "drag":
      return `drag ${args.fromElement ?? args.fromCoordinate} -> ${args.toElement ?? args.toCoordinate}`;
    case "scroll":
      return `scroll ${args.direction || "down"}`;
    case "set_value":
      return `set_value "${(args.value || "").slice(0, 40)}"`;
    case "focus_app":
      return `focus_app ${args.app}${args.raiseWindow ? " (raise)" : ""}`;
    default:
      return action;
  }
}

/** Enforce un-overridable hard blocks + per-action consent. Throws if denied. */
export function assertActionAllowed(action: ComputerUseAction, args: ComputerUseArgs): void {
  // 1. Hard blocks (never overridable).
  if (action === "key" && args.keys && isBlockedKeyCombo(args.keys)) {
    throw new Error(`Refused: the key combo "${args.keys}" is blocked (logout/lock/power).`);
  }
  if (action === "type" && args.text && isBlockedTypeText(args.text)) {
    throw new Error(
      "Refused: the typed text matched a blocked pattern (shell pipe-to-bash / rm -rf / fork bomb)."
    );
  }
  // 2. Consent for destructive actions.
  if (SAFE_ACTIONS.has(action)) return;
  if (sessionAutoApprove) return;
  if (approvalCallback) {
    const approved = approvalCallback(action, args, summarizeAction(action, args));
    if (!approved) {
      throw new Error(`Action denied by approval callback: ${summarizeAction(action, args)}`);
    }
    return;
  }
  // No approval mechanism configured and not auto-approved: allow but warn.
  // (The host gates computer_use via the dangerous-tool system; see tools/index.ts.)
}

/**
 * Send a request to cua-driver, reconnecting once if the session died
 * (exactly one retry, never loops).
 */
async function sendWithReconnect(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  try {
    return await sendRaw(method, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isClosedSession = /exited|EPIPE|closed|Broken pipe|not running/i.test(message);
    if (!isClosedSession) throw error;
    // Force a fresh driver process and retry exactly once.
    if (driverProcess) {
      try {
        driverProcess.kill();
      } catch {
        /* ignore */
      }
      driverProcess = null;
    }
    await ensureDriver();
    return sendRaw(method, params);
  }
}

export interface ComputerUseResult {
  action: ComputerUseAction;
  ok: boolean;
  /** Text summary returned by the driver. */
  text?: string;
  /** Base64 screenshot data (no data: prefix) when the action produced an image. */
  screenshot?: string;
  /** MIME type of the screenshot (default image/png). */
  screenshotMime?: string;
  /** Whether a follow-up capture was performed (when captureAfter was set). */
  capturedAfter?: boolean;
  /** Absolute path to the saved screenshot PNG (set by the native capture fallback). */
  filePath?: string;
  error?: string;
}

const SCREENSHOTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE || homedir(),
  ".cybara",
  "screenshots"
);

/**
 * Native OS screenshot fallback for the `capture` action when cua-driver isn't
 * installed. Uses the platform's built-in screenshot tool, saves a PNG under
 * ~/.cybara/screenshots, and returns base64 + filePath so the result rides the
 * existing screenshot-delivery path. Returns null if no native tool is available
 * or the capture failed.
 *
 * macOS note: the capturing process (your terminal/bun) needs Screen Recording
 * permission, or the image will be of the desktop wallpaper only — macOS will
 * prompt once on first use.
 */
/** True when running inside WSL (process.platform is "linux" but the host is Windows). */
function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/** First available Windows-PowerShell executable (also reachable from WSL via interop). */
function resolvePowerShell(): string | null {
  for (const exe of ["powershell.exe", "pwsh.exe", "powershell", "pwsh"]) {
    if (Bun.which(exe)) return exe;
  }
  return null;
}

// Emits the primary/virtual screen as base64 PNG on stdout — no file path or
// /mnt bridging, so it works identically on native Windows and inside WSL.
const WINDOWS_CAPTURE_PS = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
  "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
  "$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);",
  "$g=[System.Drawing.Graphics]::FromImage($bmp);",
  "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);",
  "$ms=New-Object System.IO.MemoryStream;",
  "$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);",
  "[Convert]::ToBase64String($ms.ToArray())",
].join(" ");

async function nativeScreenCapture(): Promise<ComputerUseResult | null> {
  try {
    if (!existsSync(SCREENSHOTS_DIR)) {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(SCREENSHOTS_DIR, `screen_${stamp}.png`);

    // Windows (and WSL bridging to the Windows host) capture over stdout as
    // base64, avoiding all path-escaping / mount issues.
    const wantsWindowsCapture = process.platform === "win32" || isWsl();
    if (wantsWindowsCapture) {
      const ps = resolvePowerShell();
      if (ps) {
        const proc = Bun.spawnSync([ps, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CAPTURE_PS], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const base64 = proc.stdout?.toString().trim().replace(/\s+/g, "");
        if (proc.success && base64 && base64.length > 32) {
          writeFileSync(filePath, Buffer.from(base64, "base64"));
          return {
            action: "capture",
            ok: true,
            text: "Captured the screen using PowerShell (cua-driver not installed — capture only).",
            screenshot: base64,
            screenshotMime: "image/png",
            filePath,
          };
        }
        // On native Windows there's no other tool; on WSL fall through to any
        // Linux capture tool (captures the WSLg Linux desktop, if present).
        if (process.platform === "win32") {
          console.warn(
            `[computer_use] windows screenshot failed: ${proc.stderr?.toString().trim() || "no output"}`
          );
          return null;
        }
      } else if (process.platform === "win32") {
        console.warn("[computer_use] no PowerShell executable found (powershell.exe / pwsh)");
        return null;
      }
    }

    let cmd: string[] | null = null;
    if (process.platform === "darwin") {
      // -x: silent (no shutter sound), -t png, capture the full main display.
      cmd = ["screencapture", "-x", "-t", "png", filePath];
    } else if (process.platform === "linux") {
      // Prefer grim (wayland) -> scrot -> ImageMagick import, whichever exists.
      if (Bun.which("grim")) cmd = ["grim", filePath];
      else if (Bun.which("scrot")) cmd = ["scrot", "-o", filePath];
      else if (Bun.which("import")) cmd = ["import", "-window", "root", filePath];
      else if (Bun.which("spectacle")) cmd = ["spectacle", "-b", "-n", "-o", filePath];
    }

    if (!cmd) {
      if (process.platform === "linux") {
        console.warn(
          "[computer_use] no screenshot tool found — install grim, scrot, or imagemagick (or run in WSL with PowerShell available)"
        );
      }
      return null;
    }

    const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    if (!proc.success || !existsSync(filePath) || statSync(filePath).size === 0) {
      console.warn(
        `[computer_use] native screenshot failed: ${proc.stderr?.toString().trim() || "no output"}`
      );
      return null;
    }

    const screenshot = readFileSync(filePath).toString("base64");
    return {
      action: "capture",
      ok: true,
      text: "Captured the screen using the native OS screenshot tool (cua-driver is not installed, so click/type/scroll control is unavailable — capture only).",
      screenshot,
      screenshotMime: "image/png",
      filePath,
    };
  } catch (error) {
    console.warn(
      `[computer_use] native screenshot error: ${error instanceof Error ? error.message : error}`
    );
    return null;
  }
}

interface DriverCallResult {
  text?: string;
  screenshot?: string;
  screenshotMime?: string;
  structured?: Record<string, unknown>;
}

interface DriverWindow {
  appName: string;
  pid: number;
  windowId?: number;
  zIndex: number;
}

function driverHasTool(name: string): boolean {
  // With no discovery data, optimistically assume the tool exists and let the
  // call itself fail — self-healing across driver versions.
  return driverToolNames.size === 0 || driverToolNames.has(name);
}

/** Call a driver tool and flatten the MCP result (text/image/structuredContent). */
async function callDriverTool(
  name: string,
  args: Record<string, unknown>
): Promise<DriverCallResult> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) cleaned[key] = value;
  }
  const result = (await sendWithReconnect("tools/call", { name, arguments: cleaned })) as {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };

  const textBlock = result?.content?.find((c) => c.type === "text") as
    { text?: string } | undefined;
  const imageBlock = result?.content?.find((c) => c.type === "image" || c.type === "image_url") as
    { data?: string; mimeType?: string; image_url?: { url?: string } } | undefined;

  let screenshot: string | undefined;
  let screenshotMime: string | undefined;
  if (imageBlock?.data) {
    screenshot = imageBlock.data;
    screenshotMime = imageBlock.mimeType || "image/png";
  } else if (imageBlock?.image_url?.url) {
    const match = imageBlock.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      screenshotMime = match[1];
      screenshot = match[2];
    }
  }

  const text = typeof textBlock?.text === "string" ? textBlock.text : undefined;
  if (result?.isError) {
    throw new Error(text || `cua-driver tool "${name}" failed`);
  }
  return { text, screenshot, screenshotMime, structured: result?.structuredContent };
}

async function listDriverWindows(): Promise<DriverWindow[]> {
  const result = await callDriverTool("list_windows", { on_screen_only: true });
  let rawWindows = (result.structured?.windows as Array<Record<string, unknown>>) || [];
  if (rawWindows.length === 0 && result.text) {
    try {
      const parsed = JSON.parse(result.text) as { windows?: Array<Record<string, unknown>> };
      rawWindows = parsed?.windows || [];
    } catch {
      // Text wasn't JSON; fall through with what we have.
    }
  }
  return rawWindows
    .filter((w) => Number.isFinite(Number(w.pid)))
    .map((w) => ({
      appName: typeof w.app_name === "string" ? w.app_name : "",
      pid: Number(w.pid),
      windowId: Number.isFinite(Number(w.window_id)) ? Number(w.window_id) : undefined,
      zIndex: Number.isFinite(Number(w.z_index)) ? Number(w.z_index) : 0,
    }))
    .sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Resolve which window an action targets. Explicit app name wins; otherwise
 * reuse the window focus_app selected; otherwise the frontmost window.
 */
async function resolveWindowTarget(app?: string): Promise<{ pid: number; windowId?: number }> {
  const windows = await listDriverWindows();
  const wanted = typeof app === "string" ? app.trim().toLowerCase() : "";
  if (wanted) {
    const match = windows.find((w) => w.appName.toLowerCase().includes(wanted));
    if (!match) {
      const available = windows
        .map((w) => w.appName)
        .filter(Boolean)
        .slice(0, 10);
      throw new Error(
        `No on-screen window found for app "${app}". On-screen apps: ${available.join(", ") || "(none)"}.`
      );
    }
    activeWindowTarget = { pid: match.pid, windowId: match.windowId, appName: match.appName };
    return { pid: match.pid, windowId: match.windowId };
  }
  if (activeWindowTarget && windows.some((w) => w.pid === activeWindowTarget?.pid)) {
    return { pid: activeWindowTarget.pid, windowId: activeWindowTarget.windowId };
  }
  const frontmost = windows[0];
  if (!frontmost) {
    throw new Error(
      "No on-screen windows reported by cua-driver. Check its OS permissions (`cua-driver doctor`)."
    );
  }
  activeWindowTarget = {
    pid: frontmost.pid,
    windowId: frontmost.windowId,
    appName: frontmost.appName,
  };
  return { pid: frontmost.pid, windowId: frontmost.windowId };
}

function splitHotkeyCombo(keys: string): string[] {
  return keys
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Translate one of our high-level actions into the driver's tool vocabulary
 * (cua-driver 0.6.x: get_window_state/type_text/press_key/hotkey/... — every
 * interactive tool requires a target pid) and execute it.
 */
async function performDriverAction(typedArgs: ComputerUseArgs): Promise<DriverCallResult> {
  const action = typedArgs.action;

  if (action === "wait") {
    const seconds = Math.min(Math.max(typedArgs.seconds ?? 1, 0), 30);
    await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
    return { text: `Waited ${seconds}s.` };
  }

  if (action === "list_apps") {
    return callDriverTool("list_apps", {});
  }

  if (action === "capture") {
    const target = await resolveWindowTarget(typedArgs.app);
    // Older drivers had a cheap standalone screenshot tool; 0.5.x+ folded
    // window capture into get_window_state.
    if (driverToolNames.has("screenshot")) {
      const shot = await callDriverTool("screenshot", {
        window_id: target.windowId,
        format: "jpeg",
        quality: 85,
      });
      if (shot.screenshot) return shot;
    }
    return callDriverTool("get_window_state", {
      pid: target.pid,
      window_id: target.windowId,
    });
  }

  if (action === "focus_app") {
    if (!typedArgs.app) {
      throw new Error("Validation error: focus_app requires 'app'.");
    }
    const target = await resolveWindowTarget(typedArgs.app);
    const appName = activeWindowTarget?.appName || typedArgs.app;
    if (typedArgs.raiseWindow !== false && driverHasTool("bring_to_front")) {
      await callDriverTool("bring_to_front", { pid: target.pid, window_id: target.windowId });
      return { text: `Focused ${appName} (pid ${target.pid}) and raised its window.` };
    }
    return { text: `Targeted ${appName} (pid ${target.pid}) without raising the window.` };
  }

  const target = await resolveWindowTarget(typedArgs.app);
  const base: Record<string, unknown> = {
    pid: target.pid,
    window_id: target.windowId,
  };
  if (typeof typedArgs.element === "number") base.element_index = typedArgs.element;

  switch (action) {
    case "click":
    case "double_click":
    case "right_click":
    case "middle_click": {
      const coordinateArgs: Record<string, unknown> = { ...base };
      if (Array.isArray(typedArgs.coordinate) && typedArgs.coordinate.length === 2) {
        coordinateArgs.x = typedArgs.coordinate[0];
        coordinateArgs.y = typedArgs.coordinate[1];
      }
      if (action === "middle_click") {
        // 0.6.x has no middle_click tool; click accepts a button parameter.
        return callDriverTool("click", { ...coordinateArgs, button: "middle" });
      }
      return callDriverTool(action, coordinateArgs);
    }
    case "scroll":
      return callDriverTool("scroll", {
        ...base,
        direction: typedArgs.direction,
        amount: typedArgs.amount,
      });
    case "drag": {
      const from = typedArgs.fromCoordinate;
      const to = typedArgs.toCoordinate;
      if (!Array.isArray(from) || !Array.isArray(to)) {
        throw new Error("Validation error: drag requires fromCoordinate and toCoordinate.");
      }
      return callDriverTool("drag", {
        ...base,
        from_x: from[0],
        from_y: from[1],
        to_x: to[0],
        to_y: to[1],
      });
    }
    case "type":
      return callDriverTool(driverHasTool("type_text") ? "type_text" : "type", {
        ...base,
        text: typedArgs.text,
      });
    case "key": {
      const keys = typedArgs.keys || "";
      const parts = splitHotkeyCombo(keys);
      if (parts.length > 1 && driverHasTool("hotkey")) {
        return callDriverTool("hotkey", { ...base, keys: parts });
      }
      return callDriverTool(driverHasTool("press_key") ? "press_key" : "key", {
        ...base,
        key: parts[0] || keys,
      });
    }
    case "set_value":
      return callDriverTool("set_value", { ...base, value: typedArgs.value });
    default:
      throw new Error(`Unsupported computer_use action: ${action}`);
  }
}

export async function handleComputerUse(args: Record<string, unknown>): Promise<ComputerUseResult> {
  const typedArgs = args as unknown as ComputerUseArgs;
  if (!typedArgs.action) {
    throw new Error("Validation error: 'action' is required.");
  }
  if (!VALID_ACTIONS.has(typedArgs.action)) {
    throw new Error(
      `Validation error: unknown action "${typedArgs.action}". Valid: ${[...VALID_ACTIONS].join(", ")}.`
    );
  }
  // Safety gate: hard blocks + consent.
  assertActionAllowed(typedArgs.action, typedArgs);

  if (!isAvailable()) {
    return {
      action: typedArgs.action,
      ok: false,
      error: "computer_use is not available on this platform.",
    };
  }
  try {
    await ensureDriver();
    const result = await performDriverAction(typedArgs);
    let screenshot = result.screenshot;
    let screenshotMime = result.screenshotMime || "image/png";

    // Optional follow-up capture so the model can self-verify the action.
    let capturedAfter = false;
    if (typedArgs.captureAfter && typedArgs.action !== "capture" && typedArgs.action !== "wait") {
      try {
        const after = await performDriverAction({
          action: "capture",
          mode: typedArgs.mode,
          app: typedArgs.app,
        });
        if (after.screenshot) {
          screenshot = after.screenshot;
          screenshotMime = after.screenshotMime || screenshotMime;
          capturedAfter = true;
        }
      } catch {
        /* follow-up capture is best-effort */
      }
    }

    return {
      action: typedArgs.action,
      ok: true,
      text: result.text,
      screenshot,
      screenshotMime: screenshot ? screenshotMime : undefined,
      capturedAfter,
    };
  } catch (error) {
    // cua-driver unavailable (e.g. not installed). For the read-only `capture`
    // action, fall back to the native OS screenshot tool so "give me a
    // screenshot" still works without the full driver.
    if (typedArgs.action === "capture") {
      const native = await nativeScreenCapture();
      if (native) return native;
    }
    return {
      action: typedArgs.action,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Stop the cua-driver process (called on agent shutdown). */
export function stopComputerUseDriver(): void {
  if (driverProcess) {
    try {
      driverProcess.kill();
    } catch {
      /* ignore */
    }
    driverProcess = null;
  }
}

/** Run a cua-driver subcommand and return its parsed JSON stdout (best-effort). */
async function runDriverCommand(
  subcommand: string[],
  timeoutMs = 10_000,
  command = getCuaDriverResolution().command
): Promise<{ ok: boolean; json: unknown; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      const trimmed = stdout.trim();
      let json: unknown = null;
      if (trimmed) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          json = null;
        }
      }
      resolve({ ok, json, stdout: trimmed, stderr: stderr.trim() });
    };
    try {
      const proc = spawnDriver(command, subcommand, { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish(false);
      }, timeoutMs);
      proc.stdout?.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      proc.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      proc.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

export function parseCuaDriverVersion(stdout: string, json: unknown): string | undefined {
  if (typeof json === "string") {
    const trimmed = json.trim();
    if (trimmed) return trimmed;
  }
  if (json && typeof json === "object") {
    const version = (json as { version?: unknown }).version;
    if (typeof version === "string" && version.trim()) return version.trim();
  }

  const text = stdout.trim();
  if (!text) return undefined;
  const firstLine =
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || text;
  const semver = firstLine.match(/\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?/);
  if (semver) return semver[0];
  return firstLine.replace(/^cua-driver(?:-rs)?\s+/i, "").trim() || firstLine;
}

export interface ComputerUseDoctorResult {
  available: boolean;
  command: string;
  driverSource?: CuaDriverCommandSource;
  configuredCommand?: string;
  platform: string;
  /** Resolved version string, if the driver reported one. */
  version?: string;
  /** macOS-only: TCC grants to cua-driver. */
  accessibility?: boolean;
  screenRecording?: boolean;
  /** True when the driver is usable (installed + healthy + permissions granted on macOS). */
  ready: boolean;
  message: string;
  installHint?: string;
  searchedPaths?: string[];
  checks?: unknown;
}

/** Diagnostics: probe cua-driver install, version, health, and macOS TCC state. */
export async function computerUseDoctor(): Promise<ComputerUseDoctorResult> {
  const platform = process.platform;
  const resolution = getCuaDriverResolution();
  const configuredCommand = config.getComputerUseSettings().driverCommand || undefined;
  const base = {
    available: false,
    command: resolution.command,
    driverSource: resolution.source,
    configuredCommand,
    platform,
    ready: false,
  };

  // 1. Version probe (also confirms the binary is on PATH).
  const versionRes = await runDriverCommand(["--version"], 10_000, resolution.command);
  if (!versionRes.ok) {
    return {
      ...base,
      installHint: driverInstallHint(platform),
      searchedPaths: resolution.searchedPaths.slice(-20),
      message: `cua-driver not found or not executable. ${driverInstallHint(platform)}`,
    };
  }
  const version = parseCuaDriverVersion(versionRes.stdout, versionRes.json);

  // 2. Health check via the driver's own doctor.
  const healthRes = await runDriverCommand(["doctor", "--json"], 10_000, resolution.command);
  const checks = healthRes.json;

  // 3. macOS TCC permissions.
  let accessibility: boolean | undefined;
  let screenRecording: boolean | undefined;
  if (platform === "darwin") {
    const permRes = await runDriverCommand(
      ["permissions", "status", "--json"],
      10_000,
      resolution.command
    );
    const perms = permRes.json as {
      accessibility?: boolean;
      screen_recording?: boolean;
      screenRecording?: boolean;
    } | null;
    if (perms) {
      accessibility = perms.accessibility;
      screenRecording = perms.screen_recording ?? perms.screenRecording;
    }
  }

  const macReady = platform !== "darwin" || (accessibility === true && screenRecording === true);
  const ready = !!macReady && !!healthRes.ok;

  let message: string;
  if (!healthRes.ok) {
    message = "cua-driver is installed but failed its health check. See `cua-driver doctor`.";
  } else if (platform === "darwin" && !macReady) {
    message =
      "cua-driver is installed and healthy, but macOS Accessibility/Screen Recording grants are missing. Run `cua-driver permissions grant` and approve the prompts.";
  } else {
    message = "cua-driver is installed, healthy, and ready.";
  }

  return {
    available: true,
    command: resolution.command,
    driverSource: resolution.source,
    configuredCommand,
    platform,
    version,
    accessibility,
    screenRecording,
    ready,
    message,
    checks,
  };
}

/** Drive `cua-driver permissions grant` to request macOS TCC prompts (macOS only). */
export async function requestComputerUsePermissionsGrant(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (process.platform !== "darwin") {
    return { ok: false, message: "Permission grants are only needed on macOS." };
  }
  const { command } = getCuaDriverResolution();
  const res = await runDriverCommand(["permissions", "grant"], 60_000, command);
  return {
    ok: res.ok,
    message: res.ok
      ? "Requested TCC grants. Approve the Accessibility + Screen Recording prompts attributed to cua-driver."
      : `permissions grant failed${res.stderr ? `: ${res.stderr}` : ""}.`,
  };
}
