#!/usr/bin/env bun

import { mkdirSync, chmodSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type UploadCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunUploadCommand = (command: string[]) => Promise<UploadCommandResult>;

export type TestFlightUploadOptions = {
  ipaPath: string;
  apiKeyBase64: string;
  apiKeyId: string;
  apiIssuerId: string;
  attempts?: number;
  retryBaseDelayMs?: number;
  homeDir?: string;
  runCommand?: RunUploadCommand;
  sleep?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 20_000;

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function classifyTestFlightUploadFailure(output: string): "transient" | "fatal" {
  const normalized = output.toLowerCase();
  if (
    /\bstatus code 5\d\d\b/.test(normalized) ||
    /\bstatus\s*:\s*5\d\d\b/.test(normalized) ||
    /\bhttp\s*5\d\d\b/.test(normalized) ||
    normalized.includes("internal server error") ||
    normalized.includes("server side") ||
    normalized.includes("service unavailable") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("gateway timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("connection reset") ||
    normalized.includes("network connection was lost")
  ) {
    return "transient";
  }
  return "fatal";
}

export function nextRetryDelayMs(attempt: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 180_000);
}

function stageAppStoreConnectKey(home: string, keyId: string, keyBase64: string): string {
  const keyDir = join(home, ".appstoreconnect", "private_keys");
  const keyPath = join(keyDir, `AuthKey_${keyId}.p8`);
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(keyPath, Buffer.from(keyBase64, "base64"));
  chmodSync(keyPath, 0o600);
  return keyPath;
}

async function runAltoolUpload(command: string[]): Promise<UploadCommandResult> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadIpaToTestFlight(options: TestFlightUploadOptions): Promise<boolean> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const retryBaseDelayMs = Math.max(1, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const runCommand = options.runCommand ?? runAltoolUpload;
  const sleepFn = options.sleep ?? sleep;
  const warn = options.warn ?? ((message) => console.warn(message));
  const keyPath = stageAppStoreConnectKey(
    options.homeDir ?? homedir(),
    options.apiKeyId,
    options.apiKeyBase64
  );

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      console.log(`Uploading iOS IPA to TestFlight (attempt ${attempt}/${attempts}).`);
      const result = await runCommand([
        "xcrun",
        "altool",
        "--upload-app",
        "-f",
        options.ipaPath,
        "-t",
        "ios",
        "--apiKey",
        options.apiKeyId,
        "--apiIssuer",
        options.apiIssuerId,
      ]);
      if (result.exitCode === 0) {
        console.log("TestFlight upload completed.");
        return true;
      }

      const output = `${result.stdout}\n${result.stderr}`;
      const classification = classifyTestFlightUploadFailure(output);
      if (classification === "fatal") {
        throw new Error(`TestFlight upload failed with a non-retryable error:\n${output.trim()}`);
      }

      if (attempt === attempts) {
        warn(
          "TestFlight upload failed after retries because Apple Transporter/App Store Connect returned a transient server or network error. The signed IPA will still be attached to the GitHub release for manual retry."
        );
        return false;
      }

      const delayMs = nextRetryDelayMs(attempt, retryBaseDelayMs);
      console.warn(
        `Transient TestFlight upload failure; retrying in ${Math.round(delayMs / 1000)}s.`
      );
      await sleepFn(delayMs);
    }
  } finally {
    try {
      unlinkSync(keyPath);
    } catch {}
  }

  return false;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for TestFlight upload.`);
  }
  return value;
}

if (import.meta.main) {
  const ipaPath = Bun.argv[2]?.trim();
  if (!ipaPath) {
    console.error("Usage: bun run scripts/upload-ios-testflight.ts <path-to-ipa>");
    process.exit(1);
  }

  uploadIpaToTestFlight({
    ipaPath,
    apiKeyBase64: requireEnv("ASC_KEY"),
    apiKeyId: requireEnv("ASC_KEY_ID"),
    apiIssuerId: requireEnv("ASC_ISSUER_ID"),
    attempts: parsePositiveInt(process.env.TESTFLIGHT_UPLOAD_ATTEMPTS, DEFAULT_ATTEMPTS),
    retryBaseDelayMs: parsePositiveInt(process.env.TESTFLIGHT_UPLOAD_RETRY_BASE_SECONDS, 20) * 1000,
    warn: (message) => console.warn(`::warning::${message}`),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
