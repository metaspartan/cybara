import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PNG } from "pngjs";

export type MobileSimulatorPlatform = "ios" | "android";
export type MobileSimulatorState = "booted" | "shutdown" | "offline";
export const MOBILE_SIMULATOR_ACTIONS = [
  "tap",
  "swipe",
  "text",
  "key",
  "open_url",
  "install",
  "launch",
  "describe",
] as const;
export type MobileSimulatorActionName = (typeof MOBILE_SIMULATOR_ACTIONS)[number];

export interface MobileSimulatorDevice {
  id: string;
  name: string;
  platform: MobileSimulatorPlatform;
  state: MobileSimulatorState;
  runtime?: string;
  interactive: boolean;
}

export interface MobileSimulatorPlatformStatus {
  platform: MobileSimulatorPlatform;
  supported: boolean;
  installed: boolean;
  interactive: boolean;
  reason?: string;
  devices: MobileSimulatorDevice[];
}

export interface MobileSimulatorStatus {
  ios: MobileSimulatorPlatformStatus;
  android: MobileSimulatorPlatformStatus;
}

export interface MobileSimulatorFrame {
  bytes?: Buffer;
  contentType: "image/jpeg" | "image/png";
  device: MobileSimulatorDevice;
  height: number;
  revision: string;
  unchanged: boolean;
  width: number;
}

interface CommandResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

interface SimctlDevice {
  udid?: unknown;
  name?: unknown;
  state?: unknown;
  isAvailable?: unknown;
}

interface SimctlDeviceList {
  devices?: Record<string, SimctlDevice[]>;
}

interface CachedFrame {
  bytes: Buffer;
  capturedAt: number;
  contentType: "image/jpeg" | "image/png";
  device: MobileSimulatorDevice;
  height: number;
  revision: string;
  width: number;
}

const COMMAND_TIMEOUT_MS = 20_000;
const BOOT_TIMEOUT_MS = 120_000;
const FRAME_CACHE_MS = 450;
const MAX_CACHED_FRAMES = 8;
const ANDROID_PREVIEW_MAX_WIDTH = 720;
const ANDROID_PREVIEW_MAX_HEIGHT = 1_600;
const screenshotDir = join(
  process.env.HOME || process.env.USERPROFILE || homedir(),
  ".cybara",
  "screenshots"
);
const frameCache = new Map<string, CachedFrame>();
const iosScaleCache = new Map<string, number>();

function firstExisting(paths: Array<string | null | undefined>): string | null {
  for (const path of paths) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

export function resolveAndroidSdkExecutable(
  name: "adb" | "emulator",
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME || env.USERPROFILE || homedir()
): string | null {
  const fromPath = Bun.which(name) ?? Bun.which(platform === "win32" ? `${name}.exe` : name);
  if (fromPath) return fromPath;
  const executable = platform === "win32" ? `${name}.exe` : name;
  const roots = [
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    platform === "darwin" ? join(home, "Library", "Android", "sdk") : null,
    platform === "linux" ? join(home, "Android", "Sdk") : null,
    platform === "win32" && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Android", "Sdk") : null,
  ];
  return firstExisting(
    roots.map((root) =>
      root ? join(root, name === "adb" ? "platform-tools" : "emulator", executable) : null
    )
  );
}

function resolveXcrun(): string | null {
  return process.platform === "darwin" ? Bun.which("xcrun") : null;
}

function resolveIdb(): string | null {
  return process.platform === "darwin" ? Bun.which("idb") : null;
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<CommandResult> {
  const processHandle = Bun.spawn([command, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(processHandle.stdout).arrayBuffer();
  const stderrPromise = new Response(processHandle.stderr).text();
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const exitCode = await Promise.race([
      processHandle.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Command timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
        timer.unref?.();
      }),
    ]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { stdout: Buffer.from(stdout), stderr: stderr.trim(), exitCode };
  } catch (error) {
    processHandle.kill();
    await processHandle.exited.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runChecked(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `${basename(command)} exited with code ${result.exitCode}`);
  }
  return result;
}

function iosRuntimeLabel(identifier: string): string {
  const match = identifier.match(/SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/);
  return match ? `${match[1]} ${match[2].replaceAll("-", ".")}` : identifier;
}

export function parseSimctlDevices(value: unknown, interactive: boolean): MobileSimulatorDevice[] {
  if (!value || typeof value !== "object") return [];
  const list = value as SimctlDeviceList;
  if (!list.devices || typeof list.devices !== "object") return [];
  const devices: MobileSimulatorDevice[] = [];
  for (const [runtime, entries] of Object.entries(list.devices)) {
    if (!runtime.includes(".SimRuntime.iOS-")) continue;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (
        entry.isAvailable === false ||
        typeof entry.udid !== "string" ||
        typeof entry.name !== "string"
      ) {
        continue;
      }
      devices.push({
        id: entry.udid,
        name: entry.name,
        platform: "ios",
        state: entry.state === "Booted" ? "booted" : "shutdown",
        runtime: iosRuntimeLabel(runtime),
        interactive,
      });
    }
  }
  return devices.sort((left, right) => {
    if (left.state !== right.state) return left.state === "booted" ? -1 : 1;
    const runtimeOrder = (right.runtime ?? "").localeCompare(left.runtime ?? "");
    return runtimeOrder || left.name.localeCompare(right.name);
  });
}

export function parseAdbDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (parts) => parts.length >= 2 && parts[0]?.startsWith("emulator-") && parts[1] === "device"
    )
    .map((parts) => parts[0] ?? "")
    .filter(Boolean);
}

async function listIosDevices(): Promise<MobileSimulatorDevice[]> {
  const xcrun = resolveXcrun();
  if (!xcrun) return [];
  const result = await runChecked(xcrun, ["simctl", "list", "devices", "available", "-j"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8"));
  } catch {
    return [];
  }
  return parseSimctlDevices(parsed, resolveIdb() !== null);
}

async function androidAvdName(adb: string, serial: string): Promise<string> {
  const result = await runCommand(adb, ["-s", serial, "emu", "avd", "name"]);
  const line = result.stdout
    .toString("utf8")
    .split(/\r?\n/)
    .find((value) => value.trim());
  return line?.trim() || serial;
}

async function listAndroidDevices(): Promise<MobileSimulatorDevice[]> {
  const adb = resolveAndroidSdkExecutable("adb");
  const emulator = resolveAndroidSdkExecutable("emulator");
  if (!adb && !emulator) return [];
  const devices: MobileSimulatorDevice[] = [];
  const runningNames = new Set<string>();
  if (adb) {
    const result = await runCommand(adb, ["devices", "-l"]);
    for (const serial of parseAdbDevices(result.stdout.toString("utf8"))) {
      const name = await androidAvdName(adb, serial);
      runningNames.add(name);
      devices.push({
        id: serial,
        name,
        platform: "android",
        state: "booted",
        interactive: true,
      });
    }
  }
  if (emulator) {
    const result = await runCommand(emulator, ["-list-avds"]);
    for (const name of result.stdout
      .toString("utf8")
      .split(/\r?\n/)
      .map((value) => value.trim())) {
      if (!name || runningNames.has(name)) continue;
      devices.push({
        id: name,
        name,
        platform: "android",
        state: "shutdown",
        interactive: true,
      });
    }
  }
  return devices.sort((left, right) => {
    if (left.state !== right.state) return left.state === "booted" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export async function getMobileSimulatorStatus(): Promise<MobileSimulatorStatus> {
  const xcrun = resolveXcrun();
  const idb = resolveIdb();
  const adb = resolveAndroidSdkExecutable("adb");
  const emulator = resolveAndroidSdkExecutable("emulator");
  const [iosDevices, androidDevices] = await Promise.all([
    xcrun ? listIosDevices().catch(() => []) : Promise.resolve([]),
    adb || emulator ? listAndroidDevices().catch(() => []) : Promise.resolve([]),
  ]);
  return {
    ios: {
      platform: "ios",
      supported: process.platform === "darwin",
      installed: xcrun !== null,
      interactive: idb !== null,
      reason:
        process.platform !== "darwin"
          ? "iOS Simulator requires macOS and Xcode."
          : !xcrun
            ? "Install Xcode to use iOS Simulator."
            : !idb
              ? "Preview, app launch, and screenshots are ready. Install IDB for direct taps and text input."
              : undefined,
      devices: iosDevices,
    },
    android: {
      platform: "android",
      supported: true,
      installed: adb !== null && emulator !== null,
      interactive: adb !== null,
      reason:
        !adb || !emulator
          ? "Install Android SDK Platform Tools and Android Emulator to use Android previews."
          : undefined,
      devices: androidDevices,
    },
  };
}

function selectDevice(
  devices: MobileSimulatorDevice[],
  deviceId?: string,
  requireBooted = false
): MobileSimulatorDevice {
  const normalized = deviceId?.trim();
  const device = normalized
    ? devices.find((candidate) => candidate.id === normalized || candidate.name === normalized)
    : (devices.find((candidate) => candidate.state === "booted") ?? devices[0]);
  if (!device) throw new Error("No simulator device is available");
  if (requireBooted && device.state !== "booted") {
    throw new Error(`${device.name} is not running`);
  }
  return device;
}

async function waitForAndroidBoot(adb: string, serial?: string): Promise<MobileSimulatorDevice> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const devices = await listAndroidDevices();
    const device = devices.find(
      (candidate) =>
        candidate.state === "booted" &&
        (!serial || candidate.id === serial || candidate.name === serial)
    );
    if (device) {
      const result = await runCommand(adb, [
        "-s",
        device.id,
        "shell",
        "getprop",
        "sys.boot_completed",
      ]);
      if (result.stdout.toString("utf8").trim() === "1") return device;
    }
    await Bun.sleep(750);
  }
  throw new Error("Android Emulator did not finish booting");
}

export async function startMobileSimulator(
  platform: MobileSimulatorPlatform,
  deviceId?: string
): Promise<MobileSimulatorDevice> {
  if (platform === "ios") {
    const xcrun = resolveXcrun();
    if (!xcrun) throw new Error("iOS Simulator requires macOS and Xcode");
    const device = selectDevice(await listIosDevices(), deviceId);
    if (device.state !== "booted") {
      await runChecked(xcrun, ["simctl", "boot", device.id], { timeoutMs: BOOT_TIMEOUT_MS });
      await runChecked(xcrun, ["simctl", "bootstatus", device.id, "-b"], {
        timeoutMs: BOOT_TIMEOUT_MS,
      });
    }
    return selectDevice(await listIosDevices(), device.id, true);
  }
  const adb = resolveAndroidSdkExecutable("adb");
  const emulator = resolveAndroidSdkExecutable("emulator");
  if (!adb || !emulator) throw new Error("Android SDK Platform Tools and Emulator are required");
  const devices = await listAndroidDevices();
  const selected = selectDevice(devices, deviceId);
  if (selected.state === "booted") return selected;
  const child = Bun.spawn(
    [emulator, "-avd", selected.name, "-no-window", "-no-boot-anim", "-gpu", "auto"],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" }
  );
  child.unref();
  return await waitForAndroidBoot(adb, selected.name);
}

export async function stopMobileSimulator(
  platform: MobileSimulatorPlatform,
  deviceId?: string
): Promise<void> {
  if (platform === "ios") {
    const xcrun = resolveXcrun();
    if (!xcrun) throw new Error("iOS Simulator requires macOS and Xcode");
    const device = selectDevice(await listIosDevices(), deviceId, true);
    await runChecked(xcrun, ["simctl", "shutdown", device.id]);
    clearDeviceFrames("ios", device.id);
    return;
  }
  const adb = resolveAndroidSdkExecutable("adb");
  if (!adb) throw new Error("Android SDK Platform Tools are required");
  const device = selectDevice(await listAndroidDevices(), deviceId, true);
  await runChecked(adb, ["-s", device.id, "emu", "kill"]);
  clearDeviceFrames("android", device.id);
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

async function captureIos(device: MobileSimulatorDevice): Promise<CachedFrame> {
  const xcrun = resolveXcrun();
  if (!xcrun) throw new Error("iOS Simulator requires macOS and Xcode");
  const filePath = join(tmpdir(), `cybara-ios-${device.id}-${randomUUID()}.jpg`);
  try {
    await runChecked(xcrun, ["simctl", "io", device.id, "screenshot", "--type=jpeg", filePath]);
    const bytes = readFileSync(filePath);
    const dimensions = jpegDimensions(bytes);
    if (!dimensions) throw new Error("iOS Simulator returned an invalid screenshot");
    return {
      bytes,
      capturedAt: Date.now(),
      contentType: "image/jpeg",
      device,
      ...dimensions,
      revision: createHash("sha256").update(bytes).digest("base64url").slice(0, 16),
    };
  } finally {
    try {
      unlinkSync(filePath);
    } catch {}
  }
}

async function captureAndroid(device: MobileSimulatorDevice): Promise<CachedFrame> {
  const adb = resolveAndroidSdkExecutable("adb");
  if (!adb) throw new Error("Android SDK Platform Tools are required");
  const result = await runChecked(adb, ["-s", device.id, "exec-out", "screencap", "-p"]);
  const dimensions = pngDimensions(result.stdout);
  if (!dimensions) throw new Error("Android Emulator returned an invalid screenshot");
  return {
    bytes: result.stdout,
    capturedAt: Date.now(),
    contentType: "image/png",
    device,
    ...dimensions,
    revision: createHash("sha256").update(result.stdout).digest("base64url").slice(0, 16),
  };
}

export function encodeAndroidRawPreview(raw: Buffer): {
  bytes: Buffer;
  height: number;
  width: number;
} | null {
  if (raw.length < 16) return null;
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  const format = raw.readUInt32LE(8);
  if (width < 1 || height < 1 || (format !== 1 && format !== 2)) return null;
  const expectedLength = 16 + width * height * 4;
  if (raw.length < expectedLength) return null;
  const scale = Math.min(1, ANDROID_PREVIEW_MAX_WIDTH / width, ANDROID_PREVIEW_MAX_HEIGHT / height);
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const png = new PNG({ width: previewWidth, height: previewHeight });
  const pixels = raw.subarray(16, expectedLength);
  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (y * previewWidth + x) * 4;
      png.data[targetOffset] = pixels[sourceOffset] ?? 0;
      png.data[targetOffset + 1] = pixels[sourceOffset + 1] ?? 0;
      png.data[targetOffset + 2] = pixels[sourceOffset + 2] ?? 0;
      png.data[targetOffset + 3] = format === 2 ? 255 : (pixels[sourceOffset + 3] ?? 255);
    }
  }
  return {
    bytes: PNG.sync.write(png),
    height,
    width,
  };
}

async function captureAndroidPreview(device: MobileSimulatorDevice): Promise<CachedFrame> {
  const adb = resolveAndroidSdkExecutable("adb");
  if (!adb) throw new Error("Android SDK Platform Tools are required");
  const result = await runChecked(adb, ["-s", device.id, "exec-out", "screencap"]);
  const preview = encodeAndroidRawPreview(result.stdout);
  if (!preview) return await captureAndroid(device);
  return {
    bytes: preview.bytes,
    capturedAt: Date.now(),
    contentType: "image/png",
    device,
    height: preview.height,
    revision: createHash("sha256").update(preview.bytes).digest("base64url").slice(0, 16),
    width: preview.width,
  };
}

function cacheFrame(key: string, frame: CachedFrame): void {
  frameCache.delete(key);
  frameCache.set(key, frame);
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const oldest = frameCache.keys().next().value;
    if (typeof oldest !== "string") break;
    frameCache.delete(oldest);
  }
}

function clearDeviceFrames(platform: MobileSimulatorPlatform, deviceId: string): void {
  for (const key of frameCache.keys()) {
    if (key.startsWith(`${platform}:${deviceId}:`)) frameCache.delete(key);
  }
}

export async function captureMobileSimulator(
  platform: MobileSimulatorPlatform,
  deviceId?: string,
  revision?: string,
  mode: "full" | "preview" = "full"
): Promise<MobileSimulatorFrame> {
  const devices = platform === "ios" ? await listIosDevices() : await listAndroidDevices();
  const device = selectDevice(devices, deviceId, true);
  const key = `${platform}:${device.id}:${mode}`;
  let frame = frameCache.get(key);
  if (!frame || Date.now() - frame.capturedAt > FRAME_CACHE_MS) {
    frame =
      platform === "ios"
        ? await captureIos(device)
        : mode === "preview"
          ? await captureAndroidPreview(device)
          : await captureAndroid(device);
    cacheFrame(key, frame);
  }
  const unchanged = revision === frame.revision;
  return {
    ...(unchanged ? {} : { bytes: frame.bytes }),
    contentType: frame.contentType,
    device: frame.device,
    height: frame.height,
    revision: frame.revision,
    unchanged,
    width: frame.width,
  };
}

async function iosScale(deviceId: string): Promise<number> {
  const cached = iosScaleCache.get(deviceId);
  if (cached) return cached;
  const xcrun = resolveXcrun();
  if (!xcrun) return 1;
  const result = await runCommand(xcrun, ["simctl", "io", deviceId, "enumerate"]);
  const match = result.stdout.toString("utf8").match(/Preferred UI Scale:\s*([\d.]+)/);
  const scale = match ? Number(match[1]) : 1;
  const normalized = Number.isFinite(scale) && scale > 0 ? scale : 1;
  iosScaleCache.set(deviceId, normalized);
  return normalized;
}

function finiteCoordinate(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000) {
    throw new Error("A finite non-negative coordinate is required");
  }
  return Math.round(number);
}

function safeDuration(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(10_000, Math.max(50, Math.round(number))) : 350;
}

function safeAppIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(value)) {
    throw new Error("A valid app identifier is required");
  }
  return value;
}

function safeText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
    throw new Error("Text must contain between 1 and 2000 characters");
  }
  return value;
}

function safeInstallPath(value: unknown, extensions: string[]): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("An install path is required");
  const path = resolve(value);
  if (
    !existsSync(path) ||
    !extensions.some((extension) => path.toLowerCase().endsWith(extension))
  ) {
    throw new Error(`Install path must reference an existing ${extensions.join(" or ")} package`);
  }
  return path;
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("A URL is required");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be opened");
  }
  return url.toString();
}

export interface MobileSimulatorAction {
  action: MobileSimulatorActionName;
  x?: unknown;
  y?: unknown;
  endX?: unknown;
  endY?: unknown;
  durationMs?: unknown;
  text?: unknown;
  key?: unknown;
  url?: unknown;
  path?: unknown;
  appId?: unknown;
}

export function isMobileSimulatorAction(value: unknown): value is MobileSimulatorActionName {
  return (
    typeof value === "string" &&
    MOBILE_SIMULATOR_ACTIONS.includes(value as MobileSimulatorActionName)
  );
}

async function runIosAction(
  device: MobileSimulatorDevice,
  input: MobileSimulatorAction
): Promise<Record<string, unknown>> {
  const xcrun = resolveXcrun();
  if (!xcrun) throw new Error("iOS Simulator requires macOS and Xcode");
  if (input.action === "open_url") {
    await runChecked(xcrun, ["simctl", "openurl", device.id, safeUrl(input.url)]);
    return { success: true };
  }
  if (input.action === "install") {
    const path = safeInstallPath(input.path, [".app", ".ipa"]);
    await runChecked(xcrun, ["simctl", "install", device.id, path], { timeoutMs: BOOT_TIMEOUT_MS });
    return { success: true, path };
  }
  if (input.action === "launch") {
    const appId = safeAppIdentifier(input.appId);
    const result = await runChecked(xcrun, ["simctl", "launch", device.id, appId]);
    return { success: true, appId, output: result.stdout.toString("utf8").trim() };
  }
  const idb = resolveIdb();
  if (!idb)
    throw new Error(
      "Direct iOS interaction requires IDB; preview and app actions remain available"
    );
  if (input.action === "describe") {
    const result = await runChecked(idb, [
      "ui",
      "describe-all",
      "--udid",
      device.id,
      "--json",
      "--nested",
    ]);
    return { success: true, hierarchy: result.stdout.toString("utf8") };
  }
  if (input.action === "text") {
    await runChecked(idb, [
      "ui",
      "text",
      "--udid",
      device.id,
      "--json",
      "--",
      safeText(input.text),
    ]);
    return { success: true };
  }
  if (input.action === "key") {
    const key = String(input.key || "").toUpperCase();
    if (!["APPLE_PAY", "HOME", "LOCK", "SIDE_BUTTON", "SIRI"].includes(key)) {
      throw new Error("Unsupported iOS simulator button");
    }
    await runChecked(idb, ["ui", "button", "--udid", device.id, "--json", "--", key]);
    return { success: true };
  }
  const scale = await iosScale(device.id);
  const x = Math.round(finiteCoordinate(input.x) / scale);
  const y = Math.round(finiteCoordinate(input.y) / scale);
  if (input.action === "tap") {
    await runChecked(idb, ["ui", "tap", "--udid", device.id, "--json", "--", String(x), String(y)]);
    return { success: true, x, y, scale };
  }
  const endX = Math.round(finiteCoordinate(input.endX) / scale);
  const endY = Math.round(finiteCoordinate(input.endY) / scale);
  await runChecked(idb, [
    "ui",
    "swipe",
    "--udid",
    device.id,
    "--duration",
    String(safeDuration(input.durationMs) / 1000),
    "--json",
    "--",
    String(x),
    String(y),
    String(endX),
    String(endY),
  ]);
  return { success: true, x, y, endX, endY, scale };
}

const androidKeys: Record<string, string> = {
  HOME: "3",
  BACK: "4",
  ENTER: "66",
  DELETE: "67",
  TAB: "61",
  ESCAPE: "111",
  POWER: "26",
  VOLUME_UP: "24",
  VOLUME_DOWN: "25",
};

async function runAndroidAction(
  device: MobileSimulatorDevice,
  input: MobileSimulatorAction
): Promise<Record<string, unknown>> {
  const adb = resolveAndroidSdkExecutable("adb");
  if (!adb) throw new Error("Android SDK Platform Tools are required");
  const prefix = ["-s", device.id];
  if (input.action === "tap") {
    const x = finiteCoordinate(input.x);
    const y = finiteCoordinate(input.y);
    await runChecked(adb, [...prefix, "shell", "input", "tap", String(x), String(y)]);
    return { success: true, x, y };
  }
  if (input.action === "swipe") {
    const x = finiteCoordinate(input.x);
    const y = finiteCoordinate(input.y);
    const endX = finiteCoordinate(input.endX);
    const endY = finiteCoordinate(input.endY);
    const durationMs = safeDuration(input.durationMs);
    await runChecked(adb, [
      ...prefix,
      "shell",
      "input",
      "swipe",
      String(x),
      String(y),
      String(endX),
      String(endY),
      String(durationMs),
    ]);
    return { success: true, x, y, endX, endY, durationMs };
  }
  if (input.action === "text") {
    const text = safeText(input.text);
    if (!/^[A-Za-z0-9 _.,:@/+\-=!?()]*$/.test(text)) {
      throw new Error("Android text input contains unsupported characters");
    }
    await runChecked(adb, [...prefix, "shell", "input", "text", text.replaceAll(" ", "%s")]);
    return { success: true };
  }
  if (input.action === "key") {
    const key = String(input.key || "").toUpperCase();
    const keyCode = androidKeys[key] ?? (/^\d{1,3}$/.test(key) ? key : null);
    if (!keyCode) throw new Error("Unsupported Android key");
    await runChecked(adb, [...prefix, "shell", "input", "keyevent", keyCode]);
    return { success: true, key, keyCode };
  }
  if (input.action === "open_url") {
    const url = safeUrl(input.url);
    await runChecked(adb, [
      ...prefix,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url,
    ]);
    return { success: true, url };
  }
  if (input.action === "install") {
    const path = safeInstallPath(input.path, [".apk"]);
    await runChecked(adb, [...prefix, "install", "-r", path], { timeoutMs: BOOT_TIMEOUT_MS });
    return { success: true, path };
  }
  if (input.action === "launch") {
    const appId = safeAppIdentifier(input.appId);
    await runChecked(adb, [
      ...prefix,
      "shell",
      "monkey",
      "-p",
      appId,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
    return { success: true, appId };
  }
  await runChecked(adb, [...prefix, "shell", "uiautomator", "dump", "/sdcard/cybara-window.xml"]);
  const result = await runChecked(adb, [...prefix, "shell", "cat", "/sdcard/cybara-window.xml"]);
  return { success: true, hierarchy: result.stdout.toString("utf8") };
}

export async function runMobileSimulatorAction(
  platform: MobileSimulatorPlatform,
  deviceId: string | undefined,
  input: MobileSimulatorAction
): Promise<Record<string, unknown>> {
  const devices = platform === "ios" ? await listIosDevices() : await listAndroidDevices();
  const device = selectDevice(devices, deviceId, true);
  const result =
    platform === "ios" ? await runIosAction(device, input) : await runAndroidAction(device, input);
  clearDeviceFrames(platform, device.id);
  return { ...result, device };
}

export async function saveMobileSimulatorScreenshot(
  platform: MobileSimulatorPlatform,
  deviceId?: string
): Promise<{ filePath: string; contentType: string; device: MobileSimulatorDevice }> {
  const frame = await captureMobileSimulator(platform, deviceId);
  if (!frame.bytes) throw new Error("Simulator screenshot was unchanged");
  mkdirSync(screenshotDir, { recursive: true });
  const extension = frame.contentType === "image/jpeg" ? "jpg" : "png";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(screenshotDir, `${platform}_simulator_${stamp}.${extension}`);
  writeFileSync(filePath, frame.bytes);
  return { filePath, contentType: frame.contentType, device: frame.device };
}
