import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "fs";
import { join } from "path";
import { logsDir } from "../paths";
import { redactSecretText } from "../redaction";

export type GatewayLogLevel = "debug" | "info" | "warn" | "error";

export interface GatewayLogFileOptions {
  directory?: string;
  maxFileBytes?: number;
  retainedFiles?: number;
  now?: () => Date;
}

export interface GatewayLogCaptureOptions extends GatewayLogFileOptions {
  environment?: NodeJS.ProcessEnv;
}

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const MAX_MESSAGE_CHARACTERS = 64 * 1024;

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry
    );
  } catch {
    return String(value);
  }
}

function logFilePath(directory: string, index = 0): string {
  return join(directory, index === 0 ? "gateway.out.log" : `gateway.out.${index}.log`);
}

export class GatewayLogFile {
  readonly path: string;
  private descriptor: number | null = null;
  private size = 0;
  private readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly retainedFiles: number;
  private readonly now: () => Date;

  constructor(options: GatewayLogFileOptions = {}) {
    this.directory = options.directory ?? logsDir;
    this.maxFileBytes = Math.max(1024, options.maxFileBytes ?? 5_000_000);
    this.retainedFiles = Math.max(1, options.retainedFiles ?? 5);
    this.now = options.now ?? (() => new Date());
    this.path = logFilePath(this.directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.open();
  }

  write(level: GatewayLogLevel, values: unknown[]): void {
    try {
      const raw = values.map(stringifyValue).join(" ").replace(ANSI_PATTERN, "");
      const message = redactSecretText(raw).slice(0, MAX_MESSAGE_CHARACTERS);
      const line = `${JSON.stringify({
        timestamp: this.now().toISOString(),
        level,
        source: "gateway",
        message,
      })}\n`;
      const bytes = Buffer.from(line, "utf8");
      if (this.size > 0 && this.size + bytes.byteLength > this.maxFileBytes) this.rotate();
      if (this.descriptor === null) this.open();
      if (this.descriptor === null) return;
      writeSync(this.descriptor, bytes);
      this.size += bytes.byteLength;
    } catch {}
  }

  close(): void {
    if (this.descriptor === null) return;
    try {
      closeSync(this.descriptor);
    } catch {}
    this.descriptor = null;
  }

  private open(): void {
    this.descriptor = openSync(this.path, "a", 0o600);
    this.size = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  private rotate(): void {
    this.close();
    const oldest = logFilePath(this.directory, this.retainedFiles - 1);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let index = this.retainedFiles - 2; index >= 0; index--) {
      const source = logFilePath(this.directory, index);
      if (!existsSync(source)) continue;
      renameSync(source, logFilePath(this.directory, index + 1));
    }
    this.open();
  }
}

let activeCapture: (() => void) | null = null;

export function installGatewayLogCapture(options: GatewayLogCaptureOptions = {}): () => void {
  const configured = options.environment?.CYBARA_GATEWAY_LOG_CAPTURE;
  if (configured === "0" || configured?.toLowerCase() === "false") return () => undefined;
  if (activeCapture) return activeCapture;
  const file = new GatewayLogFile(options);
  const originals = {
    debug: console.debug,
    info: console.info,
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.debug = (...values: unknown[]) => {
    file.write("debug", values);
    originals.debug(...values);
  };
  console.info = (...values: unknown[]) => {
    file.write("info", values);
    originals.info(...values);
  };
  console.log = (...values: unknown[]) => {
    file.write("info", values);
    originals.log(...values);
  };
  console.warn = (...values: unknown[]) => {
    file.write("warn", values);
    originals.warn(...values);
  };
  console.error = (...values: unknown[]) => {
    file.write("error", values);
    originals.error(...values);
  };
  const restore = () => {
    console.debug = originals.debug;
    console.info = originals.info;
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    file.close();
    activeCapture = null;
  };
  activeCapture = restore;
  return restore;
}
