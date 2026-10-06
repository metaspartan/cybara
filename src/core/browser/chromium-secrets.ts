import { createDecipheriv } from "node:crypto";

const UNWRAP_TIMEOUT_MS = 20_000;
const MAX_SECRET_BYTES = 1024;
const DPAPI_MAGIC = "DPAPI";

export type SecretUnwrapOutcome =
  | { status: "unwrapped"; secret: Buffer }
  | { status: "unsupported"; reason: string };

interface CommandResult {
  ok: boolean;
  stdout: string;
}

function run(command: string[], timeoutMs = UNWRAP_TIMEOUT_MS): CommandResult {
  const result = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    ok: result.exitCode === 0 && result.signalCode === null,
    stdout: result.stdout.toString("utf8").trim(),
  };
}

function decodeBase64Strict(value: string): Buffer | undefined {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return undefined;
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length > 0 ? decoded : undefined;
}

function windowsDpapiUnprotect(blob: Buffer): SecretUnwrapOutcome {
  const result = run([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "Add-Type -AssemblyName System.Security",
      `$b=[Convert]::FromBase64String('${blob.toString("base64")}')`,
      "$u=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null," +
        "[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Convert]::ToBase64String($u)",
    ].join("\n"),
  ]);
  if (!result.ok) {
    return {
      status: "unsupported",
      reason: "Windows could not unlock this browser's data for the signed-in user.",
    };
  }
  const secret = decodeBase64Strict(result.stdout);
  if (!secret || secret.length > MAX_SECRET_BYTES)
    return { status: "unsupported", reason: "The browser key could not be decoded." };
  return { status: "unwrapped", secret };
}

function macosKeychainSecret(account: string): SecretUnwrapOutcome {
  const result = run(["security", "find-generic-password", "-wa", account]);
  if (!result.ok || !result.stdout) {
    return {
      status: "unsupported",
      reason: "macOS could not read this browser's keychain key.",
    };
  }
  const secret = Buffer.from(result.stdout, "utf8");
  if (secret.length === 0 || secret.length > MAX_SECRET_BYTES)
    return { status: "unsupported", reason: "The browser keychain key was empty." };
  return { status: "unwrapped", secret };
}

export function unwrapChromiumKey(wrapped: Buffer, account: string): SecretUnwrapOutcome {
  if (wrapped.subarray(0, DPAPI_MAGIC.length).toString("ascii") === DPAPI_MAGIC)
    return windowsDpapiUnprotect(wrapped.subarray(DPAPI_MAGIC.length));
  if (wrapped.length === 32) return { status: "unwrapped", secret: wrapped };
  if (process.platform === "darwin") return macosKeychainSecret(account);
  return {
    status: "unsupported",
    reason: "This operating system cannot unlock the browser key automatically.",
  };
}

export type ChromiumValueDecrypt =
  | { status: "plaintext"; value: string }
  | { status: "decrypted"; value: string }
  | { status: "skipped"; reason: string };

function stripPkcs7(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer;
  const padding = buffer[buffer.length - 1];
  if (padding === undefined || padding < 1 || padding > 16 || padding > buffer.length)
    return buffer;
  const start = buffer.length - padding;
  for (let index = start; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) return buffer;
  }
  return buffer.subarray(0, start);
}

export function decryptChromiumValue(encoded: string, key: Buffer): ChromiumValueDecrypt {
  const blob = Buffer.from(encoded, "base64");
  if (blob.length === 0) return { status: "skipped", reason: "empty" };
  const prefix = blob.subarray(0, 3).toString("ascii");
  if (prefix === "v20")
    return {
      status: "skipped",
      reason: "protected by the browser's app-bound encryption, which only that browser can open",
    };
  if (prefix !== "v10" && prefix !== "v11")
    return { status: "plaintext", value: blob.toString("utf8") };
  if (key.length !== 32)
    return { status: "skipped", reason: "the browser encryption key was unavailable" };
  if (blob.length < 19)
    return { status: "skipped", reason: "the stored value was too short to decrypt" };
  try {
    const iv = blob.subarray(3, 19);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const plain = Buffer.concat([decipher.update(blob.subarray(19)), decipher.final()]);
    const value = stripPkcs7(plain).toString("utf8");
    if (!value) return { status: "skipped", reason: "the decrypted value was empty" };
    return { status: "decrypted", value };
  } catch {
    return { status: "skipped", reason: "the stored value could not be decrypted" };
  }
}
