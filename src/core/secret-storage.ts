import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";
import { secureDir } from "./paths";

const ENVELOPE_PREFIX = "cybara-secret:v1:";
const WRAPPED_KEY_PREFIX = "cybara-keybackup:v1:";
const WRAPPED_KEY_ITERATIONS = 310_000;
const KEY_FILE = join(secureDir, "storage.key");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;

let cachedKey: Buffer | undefined;

function restrictPath(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {}
}

function readExistingKey(): Buffer {
  const existing = readFileSync(KEY_FILE);
  if (existing.length !== KEY_BYTES) {
    throw new Error("The credential encryption key is invalid");
  }
  restrictPath(KEY_FILE, 0o600);
  cachedKey = existing;
  return existing;
}

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  mkdirSync(secureDir, { recursive: true, mode: 0o700 });
  restrictPath(secureDir, 0o700);
  if (existsSync(KEY_FILE)) return readExistingKey();
  const created = randomBytes(KEY_BYTES);
  try {
    writeFileSync(KEY_FILE, created, { mode: 0o600, flag: "wx" });
  } catch {
    if (existsSync(KEY_FILE)) return readExistingKey();
    throw new Error("The credential encryption key could not be created");
  }
  restrictPath(KEY_FILE, 0o600);
  cachedKey = created;
  return created;
}

export function isSealedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

export function sealSecret(value: string, context: string): string {
  if (!value || isSealedSecret(value)) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  return `${ENVELOPE_PREFIX}${payload}`;
}

export function isWrappedStorageKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(WRAPPED_KEY_PREFIX);
}

export function wrapStorageKey(key: Buffer, password: string): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("The credential encryption key is invalid");
  }
  if (!password.trim()) {
    throw new Error("A password is required to protect the credential encryption key");
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const derived = pbkdf2Sync(password, salt, WRAPPED_KEY_ITERATIONS, KEY_BYTES, "sha256");
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const payload = Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  return `${WRAPPED_KEY_PREFIX}${payload}`;
}

export function unwrapStorageKey(value: string, password: string): Buffer {
  if (!isWrappedStorageKey(value)) {
    throw new Error("The protected credential key payload is invalid");
  }
  const payload = Buffer.from(value.slice(WRAPPED_KEY_PREFIX.length), "base64url");
  if (payload.length <= SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error("The protected credential key payload is invalid");
  }
  const salt = payload.subarray(0, SALT_BYTES);
  const iv = payload.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = payload.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
  const derived = pbkdf2Sync(password, salt, WRAPPED_KEY_ITERATIONS, KEY_BYTES, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", derived, iv);
  decipher.setAuthTag(tag);
  let key: Buffer;
  try {
    key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("The backup password is incorrect or the protected key is corrupted");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error("The backup password is incorrect or the protected key is corrupted");
  }
  return key;
}

export function openSecret(value: string, context: string): string {
  if (!isSealedSecret(value)) return value;
  const payload = Buffer.from(value.slice(ENVELOPE_PREFIX.length), "base64url");
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("The encrypted credential is invalid");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
