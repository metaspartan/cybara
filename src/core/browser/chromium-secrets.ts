import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const UNWRAP_TIMEOUT_MS = 20_000;
const MAX_SECRET_BYTES = 1024;
const DPAPI_MAGIC = "DPAPI";
const MACOS_KEY_SALT = "saltysalt";
const MACOS_KEY_ITERATIONS = 1003;
const MACOS_KEY_BYTES = 16;

export type ChromiumCipher = "aes-256-cbc" | "aes-128-cbc";

export interface ChromiumSecret {
  key: Buffer;
  cipher: ChromiumCipher;
}

export type SecretUnwrapOutcome =
  | { status: "unwrapped"; secret: ChromiumSecret }
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
  return { status: "unwrapped", secret: { key: secret, cipher: "aes-256-cbc" } };
}

export function deriveMacosKeychainKey(password: Buffer): ChromiumSecret {
  return {
    key: pbkdf2Sync(password, MACOS_KEY_SALT, MACOS_KEY_ITERATIONS, MACOS_KEY_BYTES, "sha1"),
    cipher: "aes-128-cbc",
  };
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
  return { status: "unwrapped", secret: deriveMacosKeychainKey(secret) };
}

export function unwrapChromiumKey(
  wrapped: Buffer | undefined,
  account: string
): SecretUnwrapOutcome {
  if (wrapped?.subarray(0, DPAPI_MAGIC.length).toString("ascii") === DPAPI_MAGIC)
    return windowsDpapiUnprotect(wrapped.subarray(DPAPI_MAGIC.length));
  if (wrapped?.length === 32)
    return { status: "unwrapped", secret: { key: wrapped, cipher: "aes-256-cbc" } };
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

const EMPTY_SECRET: ChromiumSecret = { key: Buffer.alloc(0), cipher: "aes-256-cbc" };

export function decryptChromiumValue(
  encoded: string,
  secret: ChromiumSecret | undefined
): ChromiumValueDecrypt {
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
  const { key, cipher } = secret ?? EMPTY_SECRET;
  const expectedBytes = cipher === "aes-128-cbc" ? 16 : 32;
  if (key.length !== expectedBytes)
    return { status: "skipped", reason: "the browser encryption key was unavailable" };
  if (blob.length < 19)
    return { status: "skipped", reason: "the stored value was too short to decrypt" };
  try {
    const iv = blob.subarray(3, 19);
    const decipher = createDecipheriv(cipher, key, iv);
    const plain = Buffer.concat([decipher.update(blob.subarray(19)), decipher.final()]);
    const value = stripPkcs7(plain).toString("utf8");
    if (!value) return { status: "skipped", reason: "the decrypted value was empty" };
    return { status: "decrypted", value };
  } catch {
    return { status: "skipped", reason: "the stored value could not be decrypted" };
  }
}
