import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { PNG } from "pngjs";
import { config } from "./config";
import { setComputerUseTrajectoryStopHandler } from "./computer-use-lifecycle";
import { CUA_DRIVER_VERSION, ensureManagedCuaDriver, isExecutableFile } from "./cua-driver-runtime";
import {
  CUA_DRIVER_CMD_ENV,
  getCuaDriverResolution,
  resolveCuaDriverCommand,
  type CuaDriverCommandSource,
  type CuaDriverResolution,
} from "./computer-use-driver-resolution";
import {
  appendComputerUseTrajectoryTurn,
  createComputerUseTrajectory,
  finishComputerUseTrajectory,
  getComputerUseTrajectory,
  getComputerUseTrajectoryDir,
  getPersistedComputerUsePreview,
  type ComputerUseTrajectoryDetail,
  type ComputerUseTrajectorySurface,
  touchComputerUseTrajectory,
} from "./computer-use-trajectories";
import {
  VALID_ACTIONS,
  assertActionAllowed,
  normalizeComputerUseCompatToolArgs,
  type ComputerUseAction,
  type ComputerUseArgs,
} from "./computer-use-actions";
import {
  captureMobileSimulator,
  isMobileSimulatorAction,
  type MobileSimulatorAction,
  type MobileSimulatorPlatform,
  runMobileSimulatorAction,
} from "./mobile-simulator";

export {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
  VALID_ACTIONS,
  assertActionAllowed,
  isBlockedKeyCombo,
  isBlockedTypeText,
  normalizeComputerUseActionArgs,
  normalizeComputerUseCompatToolArgs,
  setComputerUseApprovalCallback,
  setComputerUseAutoApprove,
  summarizeAction,
  type ComputerUseAction,
  type ComputerUseArgs,
} from "./computer-use-actions";

const REQUEST_TIMEOUT_MS = 30_000;

export {
  resolveCuaDriverCommand,
  type CuaDriverCommandSource,
  type CuaDriverResolution,
} from "./computer-use-driver-resolution";

let driverProcess: ChildProcess | null = null;
let driverToolNames = new Set<string>();
let activeWindowTarget: {
  pid: number;
  windowId?: number;
  appName?: string;
} | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
let initBuffer = "";
const declaredDriverSessions = new Set<string>();

interface ActiveComputerUseTrajectory {
  id: string;
  sessionId: string;
  surface: ComputerUseTrajectorySurface;
  driverRecording: boolean;
  idleTimer: NodeJS.Timeout;
}

let activeComputerUseTrajectory: ActiveComputerUseTrajectory | null = null;
let trajectoryLifecycle: Promise<void> = Promise.resolve();
const COMPUTER_USE_TRAJECTORY_IDLE_MS = 60_000;

function isAvailable(): boolean {
  return true;
}

async function getAvailableCuaDriverResolution(): Promise<CuaDriverResolution> {
  const existing = resolveCuaDriverCommand();
  if (existing) return existing;
  const command = await ensureManagedCuaDriver();
  if (!isExecutableFile(command)) throw new Error("Managed computer-use driver is not executable");
  return {
    command,
    source: "managed-runtime",
    searchedPaths: [command],
  };
}

function driverInstallHint(platform: NodeJS.Platform = process.platform): string {
  const executableName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
  return `Cybara normally includes or securely downloads ${executableName} v${CUA_DRIVER_VERSION}. Set ${CUA_DRIVER_CMD_ENV} only to use a custom driver build.`;
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

async function ensureDriver(): Promise<void> {
  if (driverProcess && driverProcess.exitCode === null) return;

  const { command } = await getAvailableCuaDriverResolution();
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
      } catch {}
    }
  });

  driverProcess.stderr?.on("data", (chunk: Buffer) => {
    console.warn(`[cua-driver] ${chunk.toString().trim()}`);
  });

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
  sendNotification("notifications/initialized");

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
    console.warn(
      `[computer_use] tools/list failed: ${error instanceof Error ? error.message : error}`
    );
  }
}

function sendNotification(method: string): void {
  if (!driverProcess?.stdin?.writable) return;
  driverProcess.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

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
    if (driverProcess) {
      try {
        driverProcess.kill();
      } catch {}
      driverProcess = null;
    }
    declaredDriverSessions.clear();
    await ensureDriver();
    return sendRaw(method, params);
  }
}

export interface ComputerUseResult {
  action: ComputerUseAction;
  ok: boolean;
  text?: string;
  screenshot?: string;
  screenshotMime?: string;
  capturedAfter?: boolean;
  filePath?: string;
  viewport?: { width: number; height: number };
  error?: string;
}

export interface ComputerUsePreviewCursor {
  x: number;
  y: number;
  visible: boolean;
  action: "move" | "click" | "type" | "drag";
  updatedAt: number;
}

export interface ComputerUsePreviewState {
  sessionId: string;
  action: ComputerUseAction;
  app?: string;
  screenshot?: string;
  contentType?: string;
  viewport?: { width: number; height: number };
  cursor?: ComputerUsePreviewCursor;
  updatedAt: number;
  revision: number;
  screenshotRevision: number;
}

interface ComputerUseContext {
  sessionId?: string;
}

const computerUsePreviews = new Map<string, ComputerUsePreviewState>();
const computerUsePreviewViews = new Map<string, number>();
const computerUsePreviewFiles = new Map<string, string>();
const clearedComputerUsePreviews = new Set<string>();
const COMPUTER_USE_PREVIEW_ACTIVE_MS = 5_000;
const COMPUTER_USE_PREVIEW_LIMIT = 24;

function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function pointInsidePolygon(x: number, y: number, points: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    if (!currentPoint || !previousPoint) continue;
    const [currentX, currentY] = currentPoint;
    const [previousX, previousY] = previousPoint;
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function writePixel(
  png: PNG,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (png.width * y + x) * 4;
  png.data[offset] = red;
  png.data[offset + 1] = green;
  png.data[offset + 2] = blue;
  png.data[offset + 3] = alpha;
}

function paintCursorPolygon(
  png: PNG,
  originX: number,
  originY: number,
  scale: number,
  points: readonly [number, number][],
  color: readonly [number, number, number, number]
): void {
  const width = Math.ceil(22 * scale);
  const height = Math.ceil(28 * scale);
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      if (!pointInsidePolygon(x / scale, y / scale, points)) continue;
      writePixel(png, originX + x, originY + y, color[0], color[1], color[2], color[3]);
    }
  }
}

export function renderAgentCursorOnPng(screenshot: string, x: number, y: number): string {
  const png = PNG.sync.read(Buffer.from(screenshot, "base64"));
  const scale = Math.max(0.8, Math.min(2.2, Math.min(png.width, png.height) / 720));
  const originX = Math.round(x);
  const originY = Math.round(y);
  const outline: readonly [number, number][] = [
    [0, 0],
    [0, 22],
    [6, 17],
    [11, 27],
    [16, 24],
    [11, 16],
    [21, 16],
  ];
  const fill: readonly [number, number][] = [
    [2, 3],
    [2, 18],
    [7, 14],
    [12, 23],
    [13, 22],
    [8, 13],
    [17, 13],
  ];
  paintCursorPolygon(png, originX, originY, scale, outline, [15, 17, 21, 255]);
  paintCursorPolygon(png, originX, originY, scale, fill, [255, 255, 255, 255]);
  return PNG.sync.write(png).toString("base64");
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
      return {
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length + 2;
  }
  return undefined;
}

function screenshotDimensions(
  screenshot: string | undefined,
  contentType: string | undefined
): { width: number; height: number } | undefined {
  if (!screenshot) return undefined;
  const bytes = Buffer.from(screenshot, "base64");
  return contentType?.includes("jpeg") || contentType?.includes("jpg")
    ? jpegDimensions(bytes)
    : (pngDimensions(bytes) ?? jpegDimensions(bytes));
}

function captureResult(
  text: string,
  screenshot: string,
  screenshotMime: string,
  filePath?: string
): ComputerUseResult {
  const viewport = screenshotDimensions(screenshot, screenshotMime);
  return {
    action: "capture",
    ok: true,
    text: viewport ? `${text} Image size: ${viewport.width}x${viewport.height}.` : text,
    screenshot,
    screenshotMime,
    filePath,
    viewport,
  };
}

function normalizedComputerUseSessionId(value: string | undefined): string | null {
  const sessionId = value?.trim();
  return sessionId ? sessionId : null;
}

function trimComputerUsePreviews(): void {
  while (computerUsePreviews.size > COMPUTER_USE_PREVIEW_LIMIT) {
    const oldest = [...computerUsePreviews.values()].sort(
      (left, right) => left.updatedAt - right.updatedAt
    )[0];
    if (!oldest) return;
    computerUsePreviews.delete(oldest.sessionId);
    computerUsePreviewViews.delete(oldest.sessionId);
    computerUsePreviewFiles.delete(oldest.sessionId);
  }
}

function computerUseCursorFor(
  args: ComputerUseArgs,
  previous: ComputerUsePreviewCursor | undefined,
  observed?: { x: number; y: number }
): ComputerUsePreviewCursor | undefined {
  const coordinate = observed
    ? [observed.x, observed.y]
    : args.action === "drag"
      ? args.toCoordinate
      : args.coordinate;
  const action =
    args.action === "drag"
      ? "drag"
      : args.action === "type" || args.action === "key" || args.action === "set_value"
        ? "type"
        : args.action.includes("click")
          ? "click"
          : "move";
  if (Array.isArray(coordinate) && coordinate.length === 2) {
    return {
      x: coordinate[0],
      y: coordinate[1],
      visible: true,
      action,
      updatedAt: Date.now(),
    };
  }
  return previous ? { ...previous, action, updatedAt: Date.now() } : undefined;
}

export function recordComputerUsePreview(
  sessionId: string,
  args: ComputerUseArgs,
  screenshot?: string,
  contentType?: string,
  filePath?: string,
  observedCursor?: { x: number; y: number }
): void {
  clearedComputerUsePreviews.delete(sessionId);
  const previous = computerUsePreviews.get(sessionId);
  const revision = (previous?.revision ?? 0) + 1;
  computerUsePreviews.set(sessionId, {
    sessionId,
    action: args.action,
    app: args.app ?? previous?.app,
    screenshot: screenshot ?? previous?.screenshot,
    contentType: contentType ?? previous?.contentType,
    viewport: screenshotDimensions(screenshot, contentType) ?? previous?.viewport,
    cursor: computerUseCursorFor(args, previous?.cursor, observedCursor),
    updatedAt: Date.now(),
    revision,
    screenshotRevision: screenshot ? revision : (previous?.screenshotRevision ?? 0),
  });
  if (filePath) computerUsePreviewFiles.set(sessionId, filePath);
  trimComputerUsePreviews();
  renderComputerUsePreviewFile(sessionId);
}

export function getComputerUsePreview(
  sessionIdValue: string,
  knownScreenshotRevision?: number
): ComputerUsePreviewState | null {
  const sessionId = normalizedComputerUseSessionId(sessionIdValue);
  if (!sessionId) return null;
  computerUsePreviewViews.set(sessionId, Date.now());
  let preview = computerUsePreviews.get(sessionId);
  if (!preview && !clearedComputerUsePreviews.has(sessionId)) {
    const persisted = getPersistedComputerUsePreview(sessionId);
    if (persisted && VALID_ACTIONS.has(persisted.action as ComputerUseAction)) {
      preview = {
        sessionId,
        ...persisted,
        action: persisted.action as ComputerUseAction,
        cursor: persisted.cursor ? { ...persisted.cursor, visible: true } : undefined,
      };
      computerUsePreviews.set(sessionId, preview);
    }
  }
  if (!preview) return null;
  if (knownScreenshotRevision === preview.screenshotRevision) {
    return { ...preview, screenshot: undefined };
  }
  return { ...preview };
}

export function clearComputerUsePreview(sessionIdValue: string): void {
  const sessionId = normalizedComputerUseSessionId(sessionIdValue);
  if (!sessionId) return;
  clearedComputerUsePreviews.add(sessionId);
  computerUsePreviews.delete(sessionId);
  computerUsePreviewViews.delete(sessionId);
  computerUsePreviewFiles.delete(sessionId);
}

function renderComputerUsePreviewFile(sessionId: string): void {
  const preview = computerUsePreviews.get(sessionId);
  const filePath = computerUsePreviewFiles.get(sessionId);
  if (!preview?.screenshot || !preview.cursor?.visible || !filePath) return;
  if (preview.contentType && !preview.contentType.includes("png")) return;
  try {
    const screenshot = renderAgentCursorOnPng(
      preview.screenshot,
      preview.cursor.x,
      preview.cursor.y
    );
    writeFileSync(filePath, Buffer.from(screenshot, "base64"));
  } catch {
    return;
  }
}

function isComputerUsePreviewActive(sessionId: string): boolean {
  return (
    Date.now() - (computerUsePreviewViews.get(sessionId) ?? 0) <= COMPUTER_USE_PREVIEW_ACTIVE_MS
  );
}

const SCREENSHOTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE || homedir(),
  ".cybara",
  "screenshots"
);

function persistDriverScreenshot(screenshot: string, mime: string): string | undefined {
  try {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(SCREENSHOTS_DIR, `computer_${stamp}.${extension}`);
    writeFileSync(filePath, Buffer.from(screenshot, "base64"));
    return filePath;
  } catch {
    return undefined;
  }
}

function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function resolvePowerShell(): string | null {
  for (const exe of ["powershell.exe", "pwsh.exe", "powershell", "pwsh"]) {
    if (Bun.which(exe)) return exe;
  }
  return null;
}

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

export function isFullDesktopCaptureRequest(
  args: Pick<ComputerUseArgs, "action" | "app">
): boolean {
  if (args.action !== "capture") return false;
  const app = typeof args.app === "string" ? args.app.trim().toLowerCase() : "";
  return (
    !!app &&
    [
      "screen",
      "desktop",
      "display",
      "monitor",
      "full_screen",
      "full-screen",
      "entire_screen",
    ].includes(app)
  );
}

async function nativeScreenCapture(): Promise<ComputerUseResult | null> {
  try {
    if (!existsSync(SCREENSHOTS_DIR)) {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(SCREENSHOTS_DIR, `screen_${stamp}.png`);

    const wantsWindowsCapture = process.platform === "win32" || isWsl();
    if (wantsWindowsCapture) {
      const ps = resolvePowerShell();
      if (ps) {
        const proc = Bun.spawnSync(
          [ps, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CAPTURE_PS],
          {
            stdout: "pipe",
            stderr: "pipe",
          }
        );
        const base64 = proc.stdout?.toString().trim().replace(/\s+/g, "");
        if (proc.success && base64 && base64.length > 32) {
          writeFileSync(filePath, Buffer.from(base64, "base64"));
          return captureResult(
            "Captured the full desktop using PowerShell.",
            base64,
            "image/png",
            filePath
          );
        }
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
      cmd = ["screencapture", "-x", "-t", "png", filePath];
    } else if (process.platform === "linux") {
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
    return captureResult(
      "Captured the full desktop using the native OS screenshot tool.",
      screenshot,
      "image/png",
      filePath
    );
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

interface DriverApp {
  active?: boolean;
  name?: string;
  pid?: number;
  running?: boolean;
}

function driverAppsFromResult(result: DriverCallResult): DriverApp[] {
  const structuredApps = result.structured?.apps;
  if (Array.isArray(structuredApps)) return structuredApps as DriverApp[];
  if (!result.text) return [];
  try {
    const parsed = JSON.parse(result.text) as { apps?: unknown };
    return Array.isArray(parsed.apps) ? (parsed.apps as DriverApp[]) : [];
  } catch {
    return [];
  }
}

export function summarizeDriverApps(result: DriverCallResult): DriverCallResult {
  const apps = driverAppsFromResult(result);
  if (apps.length === 0) return result;
  const active = apps.find((app) => app.active === true);
  const running = apps.filter((app) => app.running === true && app.name?.trim());
  const runningNames = running.slice(0, 24).map((app) => app.name?.trim());
  const remaining = Math.max(0, running.length - runningNames.length);
  return {
    text: [
      `Frontmost app: ${active?.name?.trim() || "unknown"}.`,
      `Running apps (${running.length}): ${runningNames.join(", ") || "none"}${remaining > 0 ? `, and ${remaining} more` : ""}.`,
      `Installed apps discovered: ${apps.length}.`,
    ].join(" "),
    structured: {
      active: active
        ? {
            name: active.name,
            pid: active.pid,
            running: active.running === true,
          }
        : null,
      running: running.map((app) => ({ name: app.name, pid: app.pid })),
      installedCount: apps.length,
    },
  };
}

function driverHasTool(name: string): boolean {
  return driverToolNames.size === 0 || driverToolNames.has(name);
}

async function callDriverTool(
  name: string,
  args: Record<string, unknown>
): Promise<DriverCallResult> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) cleaned[key] = value;
  }
  const result = (await sendWithReconnect("tools/call", {
    name,
    arguments: cleaned,
  })) as {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };

  const textBlock = result?.content?.find((c) => c.type === "text") as
    | { text?: string }
    | undefined;
  const imageBlock = result?.content?.find((c) => c.type === "image" || c.type === "image_url") as
    | { data?: string; mimeType?: string; image_url?: { url?: string } }
    | undefined;

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
  return {
    text,
    screenshot,
    screenshotMime,
    structured: result?.structuredContent,
  };
}

function queueTrajectoryLifecycle(task: () => Promise<void>): Promise<void> {
  const next = trajectoryLifecycle.then(task, task);
  trajectoryLifecycle = next.catch(() => undefined);
  return next;
}

async function stopActiveComputerUseTrajectory(
  status: "completed" | "interrupted" | "error" = "completed",
  error?: string
): Promise<void> {
  const active = activeComputerUseTrajectory;
  if (!active) return;
  clearTimeout(active.idleTimer);
  activeComputerUseTrajectory = null;
  try {
    if (active.driverRecording && driverHasTool("stop_recording")) {
      await callDriverTool("stop_recording", {});
    }
    finishComputerUseTrajectory(active.id, status, error);
  } catch (reason) {
    finishComputerUseTrajectory(
      active.id,
      "error",
      reason instanceof Error ? reason.message : String(reason)
    );
  }
}

function scheduleComputerUseTrajectoryStop(): void {
  const active = activeComputerUseTrajectory;
  if (!active) return;
  clearTimeout(active.idleTimer);
  active.idleTimer = setTimeout(() => {
    void queueTrajectoryLifecycle(() => stopActiveComputerUseTrajectory("completed"));
  }, COMPUTER_USE_TRAJECTORY_IDLE_MS);
}

async function ensureComputerUseTrajectoryRecording(
  sessionId: string,
  driverReady: boolean,
  surface: ComputerUseTrajectorySurface = "desktop"
): Promise<void> {
  const settings = config.getComputerUseSettings();
  if (!settings.trajectoryCaptureEnabled) return;
  await queueTrajectoryLifecycle(async () => {
    if (
      activeComputerUseTrajectory?.sessionId === sessionId &&
      activeComputerUseTrajectory.surface === surface
    ) {
      touchComputerUseTrajectory(activeComputerUseTrajectory.id);
      scheduleComputerUseTrajectoryStop();
      return;
    }
    if (activeComputerUseTrajectory) {
      await stopActiveComputerUseTrajectory("completed");
    }
    const created = createComputerUseTrajectory({
      sessionId,
      recordVideo: surface === "desktop" && settings.trajectoryVideoEnabled,
      surface,
    });
    let driverRecording = false;
    if (driverReady && driverHasTool("start_recording")) {
      try {
        await callDriverTool("start_recording", {
          output_dir: created.dir,
          record_video: created.metadata.recordVideo,
        });
        driverRecording = true;
      } catch {}
    }
    try {
      activeComputerUseTrajectory = {
        id: created.metadata.id,
        sessionId,
        surface,
        driverRecording,
        idleTimer: setTimeout(() => undefined, COMPUTER_USE_TRAJECTORY_IDLE_MS),
      };
      scheduleComputerUseTrajectoryStop();
    } catch (error) {
      finishComputerUseTrajectory(
        created.metadata.id,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
  });
}

function appendActiveComputerUseTurn(
  sessionId: string | null,
  typedArgs: ComputerUseArgs,
  result: {
    ok: boolean;
    text?: string;
    error?: string;
    filePath?: string;
    viewport?: { width: number; height: number };
    capturedAfter?: boolean;
  },
  screenshot?: string,
  screenshotMime?: string,
  observedCursor?: { x: number; y: number }
): void {
  const active = activeComputerUseTrajectory;
  if (!sessionId || !active || active.sessionId !== sessionId) return;
  appendComputerUseTrajectoryTurn(active.id, {
    tool: typedArgs.action,
    arguments: { ...typedArgs },
    result,
    screenshot,
    screenshotMime,
    clickPoint: typedArgs.action.includes("click") ? observedCursor : undefined,
  });
  scheduleComputerUseTrajectoryStop();
}

export async function recordVisualInteractionTrajectoryTurn(input: {
  arguments: Record<string, unknown>;
  captureAfter?: () => Promise<{ screenshot?: string; screenshotMime?: string }>;
  clickPoint?: { x: number; y: number };
  result: unknown;
  sessionId?: string;
  surface: ComputerUseTrajectorySurface;
  tool: string;
}): Promise<boolean> {
  const sessionId = input.sessionId?.trim();
  if (!sessionId || !config.getComputerUseSettings().trajectoryCaptureEnabled) return false;
  await ensureComputerUseTrajectoryRecording(sessionId, false, input.surface);
  const media = await input.captureAfter?.().catch(() => undefined);
  const active = activeComputerUseTrajectory;
  if (!active || active.sessionId !== sessionId || active.surface !== input.surface) return false;
  appendComputerUseTrajectoryTurn(active.id, {
    tool: input.tool,
    arguments: input.arguments,
    result: input.result,
    screenshot: media?.screenshot,
    screenshotMime: media?.screenshotMime,
    clickPoint: input.clickPoint,
  });
  scheduleComputerUseTrajectoryStop();
  return true;
}

async function ensureDriverSession(sessionId: string): Promise<void> {
  if (declaredDriverSessions.has(sessionId) || !driverHasTool("start_session")) return;
  await callDriverTool("start_session", { session: sessionId });
  declaredDriverSessions.add(sessionId);
}

function pointFromRecord(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  for (const key of ["click_point", "clickPoint", "position", "cursor", "point"]) {
    const nested = pointFromRecord(record[key]);
    if (nested) return nested;
  }
  return undefined;
}

export function extractDriverCursorPoint(value: unknown): { x: number; y: number } | undefined {
  const direct = pointFromRecord(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const cursors = (value as Record<string, unknown>).cursors;
  if (!Array.isArray(cursors)) return undefined;
  for (const cursor of cursors) {
    const point = pointFromRecord(cursor);
    if (point) return point;
  }
  return undefined;
}

async function observedDriverCursor(
  result: DriverCallResult,
  sessionId: string | undefined
): Promise<{ x: number; y: number } | undefined> {
  const observed = extractDriverCursorPoint(result.structured);
  if (observed || !sessionId || !driverHasTool("get_agent_cursor_state")) return observed;
  try {
    const state = await callDriverTool("get_agent_cursor_state", {
      cursor_id: sessionId,
    });
    return (
      extractDriverCursorPoint(state.structured) ??
      extractDriverCursorPoint(state.text ? JSON.parse(state.text) : null)
    );
  } catch {
    return undefined;
  }
}

export function activeComputerUseTrajectoryId(): string | undefined {
  return activeComputerUseTrajectory?.id;
}

export async function stopComputerUseTrajectoryForSession(
  sessionId: string,
  status: "completed" | "interrupted" | "error" = "completed",
  error?: string
): Promise<boolean> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return false;
  let stopped = false;
  await queueTrajectoryLifecycle(async () => {
    if (activeComputerUseTrajectory?.sessionId !== normalizedSessionId) return;
    await stopActiveComputerUseTrajectory(status, error);
    stopped = true;
  });
  return stopped;
}

setComputerUseTrajectoryStopHandler(stopComputerUseTrajectoryForSession);

export async function stopComputerUseTrajectoryCapture(): Promise<void> {
  await queueTrajectoryLifecycle(() => stopActiveComputerUseTrajectory("completed"));
}

function platformForTrajectorySurface(
  surface: ComputerUseTrajectorySurface
): MobileSimulatorPlatform | null {
  if (surface === "ios_simulator") return "ios";
  if (surface === "android_emulator") return "android";
  return null;
}

function mobileActionFromTurn(argumentsValue: Record<string, unknown>): MobileSimulatorAction {
  const action = argumentsValue.action;
  if (!isMobileSimulatorAction(action)) throw new Error("Invalid recorded simulator action");
  return {
    action,
    x: argumentsValue.x,
    y: argumentsValue.y,
    endX: argumentsValue.endX,
    endY: argumentsValue.endY,
    durationMs: argumentsValue.durationMs,
    text: argumentsValue.text,
    key: argumentsValue.key,
    url: argumentsValue.url,
    path: argumentsValue.path,
    appId: argumentsValue.appId,
  };
}

async function replayMobileSimulatorTrajectory(
  source: ComputerUseTrajectoryDetail,
  platform: MobileSimulatorPlatform,
  options: { delayMs?: number; stopOnError?: boolean }
): Promise<{
  source: ComputerUseTrajectoryDetail;
  replay: ComputerUseTrajectoryDetail | null;
  result: string;
}> {
  const created = createComputerUseTrajectory({
    sessionId: `replay:${source.sessionId}`,
    recordVideo: false,
    replayOf: source.id,
    surface: source.surface,
  });
  const delayMs = Math.min(10_000, Math.max(0, options.delayMs ?? 500));
  try {
    for (const turn of source.turns) {
      const action = mobileActionFromTurn(turn.arguments);
      const deviceId =
        typeof turn.arguments.deviceId === "string" ? turn.arguments.deviceId : undefined;
      try {
        const result = await runMobileSimulatorAction(platform, deviceId, action, {
          source: "agent",
        });
        const frame = await captureMobileSimulator(platform, deviceId, undefined, "preview");
        appendComputerUseTrajectoryTurn(created.metadata.id, {
          tool: "mobile_simulator",
          arguments: turn.arguments,
          result,
          screenshot: frame.bytes?.toString("base64"),
          screenshotMime: frame.contentType,
          clickPoint:
            action.action === "tap" &&
            Number.isFinite(Number(action.x)) &&
            Number.isFinite(Number(action.y))
              ? { x: Number(action.x), y: Number(action.y) }
              : undefined,
        });
      } catch (error) {
        if (options.stopOnError !== false) throw error;
        appendComputerUseTrajectoryTurn(created.metadata.id, {
          tool: "mobile_simulator",
          arguments: turn.arguments,
          result: { error: error instanceof Error ? error.message : String(error) },
        });
      }
      if (delayMs > 0) await Bun.sleep(delayMs);
    }
    finishComputerUseTrajectory(created.metadata.id, "completed");
    return {
      source,
      replay: getComputerUseTrajectory(created.metadata.id),
      result: "Simulator trajectory replay completed.",
    };
  } catch (error) {
    finishComputerUseTrajectory(
      created.metadata.id,
      "error",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

export async function replayComputerUseTrajectory(
  id: string,
  options: { delayMs?: number; stopOnError?: boolean } = {}
): Promise<{
  source: ComputerUseTrajectoryDetail;
  replay: ComputerUseTrajectoryDetail | null;
  result: string;
}> {
  const source = getComputerUseTrajectory(id, activeComputerUseTrajectory?.id);
  if (!source) throw new Error("Computer-use trajectory not found");
  await stopComputerUseTrajectoryCapture();
  const mobilePlatform = platformForTrajectorySurface(source.surface);
  if (mobilePlatform) return replayMobileSimulatorTrajectory(source, mobilePlatform, options);
  await ensureDriver();
  const created = createComputerUseTrajectory({
    sessionId: `replay:${source.sessionId}`,
    recordVideo: false,
    replayOf: source.id,
    surface: "desktop",
  });
  try {
    await callDriverTool("start_recording", {
      output_dir: created.dir,
      record_video: false,
    });
    const replayed = await callDriverTool("replay_trajectory", {
      dir: getComputerUseTrajectoryDir(source.id),
      delay_ms: Math.min(10_000, Math.max(0, options.delayMs ?? 500)),
      stop_on_error: options.stopOnError !== false,
    });
    await callDriverTool("stop_recording", {});
    finishComputerUseTrajectory(created.metadata.id, "completed");
    return {
      source,
      replay: getComputerUseTrajectory(created.metadata.id),
      result: replayed.text ?? "Trajectory replay completed.",
    };
  } catch (error) {
    try {
      await callDriverTool("stop_recording", {});
    } catch {}
    finishComputerUseTrajectory(
      created.metadata.id,
      "error",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

async function listDriverWindows(): Promise<DriverWindow[]> {
  const result = await callDriverTool("list_windows", { on_screen_only: true });
  let rawWindows = (result.structured?.windows as Array<Record<string, unknown>>) || [];
  if (rawWindows.length === 0 && result.text) {
    try {
      const parsed = JSON.parse(result.text) as {
        windows?: Array<Record<string, unknown>>;
      };
      rawWindows = parsed?.windows || [];
    } catch {}
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
    activeWindowTarget = {
      pid: match.pid,
      windowId: match.windowId,
      appName: match.appName,
    };
    return { pid: match.pid, windowId: match.windowId };
  }
  if (activeWindowTarget && windows.some((w) => w.pid === activeWindowTarget?.pid)) {
    return {
      pid: activeWindowTarget.pid,
      windowId: activeWindowTarget.windowId,
    };
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

export function nativeFocusCommand(platform: NodeJS.Platform, app: string): string[] | null {
  return platform === "darwin" ? ["/usr/bin/open", "-a", app] : null;
}

function focusApplicationNatively(app: string): boolean {
  const command = nativeFocusCommand(process.platform, app);
  if (!command) return false;
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    throw new Error(result.stderr.toString().trim() || `Unable to focus ${app}.`);
  }
  return true;
}

async function performDriverAction(
  typedArgs: ComputerUseArgs,
  sessionId?: string
): Promise<DriverCallResult> {
  const action = typedArgs.action;

  if (action === "wait") {
    const seconds = Math.min(Math.max(typedArgs.seconds ?? 1, 0), 30);
    await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
    return { text: `Waited ${seconds}s.` };
  }

  if (action === "list_apps") {
    return summarizeDriverApps(await callDriverTool("list_apps", {}));
  }

  if (action === "capture") {
    const target = await resolveWindowTarget(typedArgs.app);
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
    if (typedArgs.raiseWindow !== false && focusApplicationNatively(appName)) {
      return {
        text: `Focused ${appName} (pid ${target.pid}) and raised its window.`,
      };
    }
    if (typedArgs.raiseWindow !== false && driverHasTool("bring_to_front")) {
      await callDriverTool("bring_to_front", {
        pid: target.pid,
        window_id: target.windowId,
      });
      return {
        text: `Focused ${appName} (pid ${target.pid}) and raised its window.`,
      };
    }
    return {
      text: `Targeted ${appName} (pid ${target.pid}) without raising the window.`,
    };
  }

  if (action === "move") {
    if (!Array.isArray(typedArgs.coordinate) || typedArgs.coordinate.length !== 2) {
      throw new Error("Validation error: move requires 'coordinate'.");
    }
    if (!driverHasTool("move_cursor")) {
      throw new Error("The installed cua-driver does not support agent cursor movement.");
    }
    return callDriverTool("move_cursor", {
      x: typedArgs.coordinate[0],
      y: typedArgs.coordinate[1],
      session: sessionId,
    });
  }

  const target = await resolveWindowTarget(typedArgs.app);
  const base: Record<string, unknown> = {
    pid: target.pid,
    window_id: target.windowId,
    session: sessionId,
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

export async function focusComputerUsePreviewApp(
  sessionIdValue: string
): Promise<{ app: string; text: string }> {
  const sessionId = normalizedComputerUseSessionId(sessionIdValue);
  if (!sessionId) throw new Error("Session ID is required");
  const preview = getComputerUsePreview(sessionId);
  const app = preview?.app?.trim();
  if (!app) throw new Error("No desktop app is available to focus for this chat");
  if (focusApplicationNatively(app)) {
    return { app, text: `Focused ${app}.` };
  }
  await ensureDriver();
  await ensureDriverSession(sessionId);
  const result = await performDriverAction(
    { action: "focus_app", app, raiseWindow: true },
    sessionId
  );
  return { app, text: result.text || `Focused ${app}.` };
}

export async function handleComputerUse(
  args: Record<string, unknown>,
  context?: ComputerUseContext
): Promise<ComputerUseResult> {
  const requestedAction = typeof args.action === "string" ? args.action : "";
  if (!requestedAction) {
    throw new Error("Validation error: 'action' is required.");
  }
  if (!VALID_ACTIONS.has(requestedAction as ComputerUseAction)) {
    throw new Error(
      `Validation error: unknown action "${requestedAction}". Valid: ${[...VALID_ACTIONS].join(", ")}.`
    );
  }
  const typedArgs = normalizeComputerUseCompatToolArgs(
    requestedAction as ComputerUseAction,
    args
  ) as unknown as ComputerUseArgs;
  const sessionId = normalizedComputerUseSessionId(context?.sessionId);
  assertActionAllowed(typedArgs.action, typedArgs);

  if (!isAvailable()) {
    return {
      action: typedArgs.action,
      ok: false,
      error: "computer_use is not available on this platform.",
    };
  }
  try {
    let driverReady = false;
    try {
      await ensureDriver();
      driverReady = true;
      if (sessionId) await ensureDriverSession(sessionId);
    } catch (error) {
      if (!isFullDesktopCaptureRequest(typedArgs)) throw error;
    }
    if (sessionId) await ensureComputerUseTrajectoryRecording(sessionId, driverReady);
    if (isFullDesktopCaptureRequest(typedArgs)) {
      const native = await nativeScreenCapture();
      if (native) {
        if (sessionId) {
          recordComputerUsePreview(
            sessionId,
            typedArgs,
            native.screenshot,
            native.screenshotMime,
            native.filePath
          );
          appendActiveComputerUseTurn(
            sessionId,
            typedArgs,
            {
              ok: true,
              text: native.text,
              filePath: native.filePath,
              viewport: native.viewport,
            },
            native.screenshot,
            native.screenshotMime
          );
        }
        return native;
      }
    }
    if (!driverReady) throw new Error("Computer-use driver is unavailable.");
    const result = await performDriverAction(typedArgs, sessionId ?? undefined);
    const observedCursor = [
      "move",
      "click",
      "double_click",
      "right_click",
      "middle_click",
      "drag",
      "type",
      "key",
      "set_value",
    ].includes(typedArgs.action)
      ? await observedDriverCursor(result, sessionId ?? undefined)
      : undefined;
    let screenshot = result.screenshot;
    let screenshotMime = result.screenshotMime || "image/png";

    let capturedAfter = false;
    const refreshActivePreview =
      sessionId !== null &&
      isComputerUsePreviewActive(sessionId) &&
      typedArgs.action !== "capture" &&
      typedArgs.action !== "wait" &&
      typedArgs.action !== "list_apps";
    if (
      (typedArgs.captureAfter || refreshActivePreview) &&
      typedArgs.action !== "capture" &&
      typedArgs.action !== "wait"
    ) {
      try {
        const after = await performDriverAction(
          {
            action: "capture",
            mode: typedArgs.mode,
            app: typedArgs.app,
          },
          sessionId ?? undefined
        );
        if (after.screenshot) {
          screenshot = after.screenshot;
          screenshotMime = after.screenshotMime || screenshotMime;
          capturedAfter = typedArgs.captureAfter === true;
        }
      } catch {}
    }

    const filePath = screenshot ? persistDriverScreenshot(screenshot, screenshotMime) : undefined;
    if (sessionId) {
      recordComputerUsePreview(
        sessionId,
        { ...typedArgs, app: typedArgs.app ?? activeWindowTarget?.appName },
        screenshot,
        screenshotMime,
        filePath,
        observedCursor
      );
    }
    const viewport = screenshotDimensions(screenshot, screenshotMime);
    const dimensionsText = viewport ? ` Image size: ${viewport.width}x${viewport.height}.` : "";
    const text = filePath
      ? `${result.text || "Capture complete."} Screenshot saved to ${filePath}.${dimensionsText}`
      : result.text
        ? `${result.text}${dimensionsText}`
        : undefined;

    const response: ComputerUseResult = {
      action: typedArgs.action,
      ok: true,
      text,
      filePath,
      screenshot,
      screenshotMime: screenshot ? screenshotMime : undefined,
      capturedAfter,
      viewport,
    };
    appendActiveComputerUseTurn(
      sessionId,
      typedArgs,
      {
        ok: true,
        text,
        filePath,
        viewport,
        capturedAfter,
      },
      screenshot,
      screenshot ? screenshotMime : undefined,
      observedCursor
    );
    return response;
  } catch (error) {
    if (typedArgs.action === "capture") {
      const native = await nativeScreenCapture();
      if (native && sessionId) {
        recordComputerUsePreview(
          sessionId,
          typedArgs,
          native.screenshot,
          native.screenshotMime,
          native.filePath
        );
      }
      if (native) {
        appendActiveComputerUseTurn(
          sessionId,
          typedArgs,
          {
            ok: true,
            text: native.text,
            filePath: native.filePath,
            viewport: native.viewport,
          },
          native.screenshot,
          native.screenshotMime
        );
        return native;
      }
    }
    appendActiveComputerUseTurn(sessionId, typedArgs, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      action: typedArgs.action,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function stopComputerUseDriver(): void {
  if (activeComputerUseTrajectory) {
    clearTimeout(activeComputerUseTrajectory.idleTimer);
    finishComputerUseTrajectory(activeComputerUseTrajectory.id, "interrupted");
    activeComputerUseTrajectory = null;
  }
  declaredDriverSessions.clear();
  if (driverProcess) {
    try {
      driverProcess.kill();
    } catch {}
    driverProcess = null;
  }
}

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
      const proc = spawnDriver(command, subcommand, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
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
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
  installHint?: string;
  searchedPaths?: string[];
  checks?: unknown;
}

export async function computerUseDoctor(): Promise<ComputerUseDoctorResult> {
  const platform = process.platform;
  const configuredCommand = config.getComputerUseSettings().driverCommand || undefined;
  let resolution: CuaDriverResolution;
  try {
    resolution = await getAvailableCuaDriverResolution();
  } catch (error) {
    const fallback = getCuaDriverResolution();
    return {
      available: false,
      command: fallback.command,
      driverSource: fallback.source,
      configuredCommand,
      platform,
      ready: false,
      installHint: driverInstallHint(platform),
      searchedPaths: fallback.searchedPaths.slice(-20),
      message: `Cybara could not prepare computer use: ${error instanceof Error ? error.message : String(error)}. ${driverInstallHint(platform)}`,
    };
  }
  const base = {
    available: false,
    command: resolution.command,
    driverSource: resolution.source,
    configuredCommand,
    platform,
    ready: false,
  };

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

  const healthRes = await runDriverCommand(["doctor", "--json"], 10_000, resolution.command);
  const checks = healthRes.json;

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

export async function requestComputerUsePermissionsGrant(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      message: "Permission grants are only needed on macOS.",
    };
  }
  const { command } = await getAvailableCuaDriverResolution();
  const res = await runDriverCommand(["permissions", "grant"], 60_000, command);
  return {
    ok: res.ok,
    message: res.ok
      ? "Requested TCC grants. Approve the Accessibility + Screen Recording prompts attributed to cua-driver."
      : `permissions grant failed${res.stderr ? `: ${res.stderr}` : ""}.`,
  };
}
