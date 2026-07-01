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
 * Requires: `cua-driver` on $PATH (override via CYBARA_CUA_DRIVER_CMD).
 * On macOS also requires Accessibility + Screen Recording TCC grants to
 * cua-driver's identity (verified by computerUseDoctor()).
 */
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CUA_DRIVER_CMD = process.env.CYBARA_CUA_DRIVER_CMD || "cua-driver";
const REQUEST_TIMEOUT_MS = 30_000;

let driverProcess: ChildProcess | null = null;
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

function driverUnavailableMessage(): string {
  const base =
    "cua-driver is not available. Install it from https://github.com/trycua/cua and ensure it is on PATH.";
  return process.platform === "darwin"
    ? `${base} Then grant macOS Accessibility + Screen Recording permissions (run \`cua-driver permissions grant\`).`
    : base;
}

/** Ensure the cua-driver MCP server process is running. */
async function ensureDriver(): Promise<void> {
  if (driverProcess && driverProcess.exitCode === null) return;

  driverProcess = spawn(CUA_DRIVER_CMD, ["mcp"], {
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

/** Per-session auto-approval for destructive actions (set by the host UI). */
let sessionAutoApprove = false;
export function setComputerUseAutoApprove(enabled: boolean): void {
  sessionAutoApprove = enabled;
}

/** Optional consent callback; if unset, destructive actions require sessionAutoApprove. */
let approvalCallback:
  | ((action: ComputerUseAction, args: ComputerUseArgs, summary: string) => boolean)
  | null = null;
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
async function sendWithReconnect(method: string, params: Record<string, unknown>): Promise<unknown> {
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
async function nativeScreenCapture(): Promise<ComputerUseResult | null> {
  try {
    if (!existsSync(SCREENSHOTS_DIR)) {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(SCREENSHOTS_DIR, `screen_${stamp}.png`);

    let cmd: string[] | null = null;
    if (process.platform === "darwin") {
      // -x: silent (no shutter sound), -t png, capture the full main display.
      cmd = ["screencapture", "-x", "-t", "png", filePath];
    } else if (process.platform === "linux") {
      // Prefer grim (wayland) -> scrot -> ImageMagick import, whichever exists.
      if (Bun.which("grim")) cmd = ["grim", filePath];
      else if (Bun.which("scrot")) cmd = ["scrot", "-o", filePath];
      else if (Bun.which("import")) cmd = ["import", "-window", "root", filePath];
    } else if (process.platform === "win32") {
      cmd = [
        "powershell",
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${filePath.replace(/\\/g, "\\\\")}',[System.Drawing.Imaging.ImageFormat]::Png)`,
      ];
    }

    if (!cmd) return null;

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
    const result = (await sendWithReconnect("tools/call", {
      name: typedArgs.action,
      arguments: typedArgs,
    })) as { content?: Array<Record<string, unknown>> };

    const textBlock = result.content?.find((c) => c.type === "text");
    const imageBlock = result.content?.find(
      (c) => c.type === "image" || c.type === "image_url"
    ) as { data?: string; mimeType?: string; image_url?: { url?: string } } | undefined;

    let screenshot: string | undefined;
    let screenshotMime = "image/png";
    if (imageBlock?.data) {
      screenshot = imageBlock.data;
      screenshotMime = imageBlock.mimeType || screenshotMime;
    } else if (imageBlock?.image_url?.url) {
      // data:image/png;base64,XXXX -> extract payload + mime.
      const match = imageBlock.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        screenshotMime = match[1];
        screenshot = match[2];
      }
    }

    // Optional follow-up capture so the model can self-verify the action.
    let capturedAfter = false;
    if (typedArgs.captureAfter && typedArgs.action !== "capture" && typedArgs.action !== "wait") {
      try {
        const afterResult = (await sendWithReconnect("tools/call", {
          name: "capture",
          arguments: { mode: typedArgs.mode },
        })) as { content?: Array<Record<string, unknown>> };
        const afterImage = afterResult.content?.find(
          (c) => c.type === "image" || c.type === "image_url"
        ) as { data?: string; mimeType?: string; image_url?: { url?: string } } | undefined;
        if (afterImage?.data) {
          screenshot = afterImage.data;
          screenshotMime = afterImage.mimeType || screenshotMime;
          capturedAfter = true;
        } else if (afterImage?.image_url?.url) {
          const m = afterImage.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            screenshotMime = m[1];
            screenshot = m[2];
            capturedAfter = true;
          }
        }
      } catch {
        /* follow-up capture is best-effort */
      }
    }

    return {
      action: typedArgs.action,
      ok: true,
      text: typeof textBlock?.text === "string" ? textBlock.text : undefined,
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
  timeoutMs = 10_000
): Promise<{ ok: boolean; json: unknown; stderr: string }> {
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
      resolve({ ok, json, stderr: stderr.trim() });
    };
    try {
      const proc = spawn(CUA_DRIVER_CMD, subcommand, { stdio: ["ignore", "pipe", "pipe"] });
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

export interface ComputerUseDoctorResult {
  available: boolean;
  command: string;
  platform: string;
  /** Resolved version string, if the driver reported one. */
  version?: string;
  /** macOS-only: TCC grants to cua-driver. */
  accessibility?: boolean;
  screenRecording?: boolean;
  /** True when the driver is usable (installed + healthy + permissions granted on macOS). */
  ready: boolean;
  message: string;
  checks?: unknown;
}

/** Diagnostics: probe cua-driver install, version, health, and macOS TCC state. */
export async function computerUseDoctor(): Promise<ComputerUseDoctorResult> {
  const platform = process.platform;
  const base = {
    available: false,
    command: CUA_DRIVER_CMD,
    platform,
    ready: false,
  };

  // 1. Version probe (also confirms the binary is on PATH).
  const versionRes = await runDriverCommand(["--version"]);
  if (!versionRes.ok) {
    return {
      ...base,
      message:
        "cua-driver not found or not executable. Install it from https://github.com/trycua/cua and ensure it is on PATH.",
    };
  }
  const version =
    typeof versionRes.json === "string"
      ? versionRes.json.trim()
      : (versionRes.json as { version?: string })?.version;

  // 2. Health check via the driver's own doctor.
  const healthRes = await runDriverCommand(["doctor", "--json"]);
  const checks = healthRes.json;

  // 3. macOS TCC permissions.
  let accessibility: boolean | undefined;
  let screenRecording: boolean | undefined;
  if (platform === "darwin") {
    const permRes = await runDriverCommand(["permissions", "status", "--json"]);
    const perms = permRes.json as
      | { accessibility?: boolean; screen_recording?: boolean; screenRecording?: boolean }
      | null;
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
    command: CUA_DRIVER_CMD,
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
  const res = await runDriverCommand(["permissions", "grant"], 60_000);
  return {
    ok: res.ok,
    message: res.ok
      ? "Requested TCC grants. Approve the Accessibility + Screen Recording prompts attributed to cua-driver."
      : `permissions grant failed${res.stderr ? `: ${res.stderr}` : ""}.`,
  };
}
