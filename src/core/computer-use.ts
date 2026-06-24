/**
 * computer_use — background desktop control via the external cua-driver.
 *
 * Ports hermes's computer_use: the agent can capture screenshots, click, type,
 * scroll, drag, and manage apps WITHOUT stealing the user's cursor (background
 * mode is a property of the cua-driver backend). The heavy platform work
 * (SkyLight SPIs on macOS, UIA on Windows, X11 on Linux) lives in the external
 * `cua-driver` binary; this module is a thin MCP-stdio client to it.
 *
 * Requires: `cua-driver` on $PATH (override via CYBARA_CUA_DRIVER_CMD).
 * On macOS also requires Accessibility + Screen Recording TCC grants to
 * cua-driver's identity.
 */
import { spawn, type ChildProcess } from "child_process";

const CUA_DRIVER_CMD =
  process.env.CYBARA_CUA_DRIVER_CMD || process.env.HERMES_CUA_DRIVER_CMD || "cua-driver";
const REQUEST_TIMEOUT_MS = 30_000;

let driverProcess: ChildProcess | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();
let initBuffer = "";

function isAvailable(): boolean {
  // We can't synchronously check PATH portably; the doctor() call verifies.
  // Treat as available and let start() surface a clear error if missing.
  return true;
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
      reject(
        new Error("cua-driver is not running. Install cua-driver and grant macOS TCC permissions.")
      );
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
  | "scroll"
  | "drag"
  | "type"
  | "key"
  | "wait"
  | "list_apps"
  | "focus_app";

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
  seconds?: number;
  raiseWindow?: boolean;
  captureAfter?: boolean;
}

export async function handleComputerUse(args: Record<string, unknown>): Promise<{
  action: ComputerUseAction;
  ok: boolean;
  result?: unknown;
  screenshot?: string;
  error?: string;
}> {
  const typedArgs = args as unknown as ComputerUseArgs;
  if (!typedArgs.action) {
    throw new Error("Validation error: 'action' is required.");
  }
  if (!isAvailable()) {
    return {
      action: typedArgs.action,
      ok: false,
      error: "computer_use is not available on this platform.",
    };
  }
  try {
    await ensureDriver();
    // Dispatch through cua-driver's tools/call for the matching action tool.
    const result = (await sendRaw("tools/call", {
      name: typedArgs.action,
      arguments: typedArgs,
    })) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = result.content?.find((c) => c.type === "text");
    const imageBlock = result.content?.find((c) => c.type === "image");
    return {
      action: typedArgs.action,
      ok: true,
      result: textBlock?.text,
      screenshot:
        imageBlock && typeof imageBlock === "object" && "data" in imageBlock
          ? (imageBlock as { data?: string }).data
          : undefined,
    };
  } catch (error) {
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

/** Diagnostics: report whether cua-driver is present and (on macOS) TCC state. */
export async function computerUseDoctor(): Promise<{
  available: boolean;
  command: string;
  platform: string;
  message: string;
}> {
  const platform = process.platform;
  try {
    await ensureDriver();
    return {
      available: true,
      command: CUA_DRIVER_CMD,
      platform,
      message:
        "cua-driver is running. On macOS, ensure Accessibility + Screen Recording are granted to cua-driver.",
    };
  } catch (error) {
    return {
      available: false,
      command: CUA_DRIVER_CMD,
      platform,
      message:
        error instanceof Error
          ? error.message
          : "cua-driver could not start. Install it (https://github.com/trycua/cua) and ensure it is on PATH.",
    };
  }
}
