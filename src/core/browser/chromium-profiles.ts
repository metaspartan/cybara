import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type {
  BrowserBookmark,
  BrowserImportCategory,
  BrowserImportCategoryAvailability,
  BrowserImportCookie,
  BrowserImportProfile,
  BrowserImportSource,
  BrowserHistoryEntry,
  ImportedLogin,
} from "../../../shared/browser-import";
import { BROWSER_IMPORT_MAX_BYTES, BROWSER_IMPORT_MAX_ENTRIES } from "./import-parsers";
import { type ChromiumSecret, decryptChromiumValue, unwrapChromiumKey } from "./chromium-secrets";

export interface BrowserImportDiscoveryOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export interface BrowserProfileData {
  passwords: ImportedLogin[];
  cookies: BrowserImportCookie[];
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
}

export interface BrowserProfileReadResult {
  data: BrowserProfileData;
  locked: BrowserImportCategory[];
  notes: string[];
}

const CHROMIUM_EPOCH_OFFSET_MS = 11_644_473_600_000;
const HISTORY_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PROFILES_PER_ROOT = 50;
const MAX_LOCKED_UNLOCKS = 2;
const LOCAL_DATABASE_MAX_BYTES = 256 * 1024 * 1024;

interface SourceLocation {
  source: BrowserImportSource;
  root: string;
  directory: string;
  userData: string;
  browser: string;
}

function isConfinementViolation(message: string): boolean {
  return /symlink|escapes its profile|too large or unavailable/i.test(message);
}

function emptyData(): BrowserProfileData {
  return { passwords: [], cookies: [], history: [], bookmarks: [] };
}

function discoveryRoots(
  options: BrowserImportDiscoveryOptions
): Array<{ browser: string; root: string }> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      { browser: "Chrome", root: join(local, "Google", "Chrome", "User Data") },
      { browser: "Edge", root: join(local, "Microsoft", "Edge", "User Data") },
      { browser: "Brave", root: join(local, "BraveSoftware", "Brave-Browser", "User Data") },
      { browser: "Chromium", root: join(local, "Chromium", "User Data") },
    ];
  }
  const base =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return platform === "darwin"
    ? [
        { browser: "Chrome", root: join(base, "Google", "Chrome") },
        { browser: "Edge", root: join(base, "Microsoft Edge") },
        { browser: "Brave", root: join(base, "BraveSoftware", "Brave-Browser") },
        { browser: "Chromium", root: join(base, "Chromium") },
      ]
    : [
        { browser: "Chrome", root: join(base, "google-chrome") },
        { browser: "Edge", root: join(base, "microsoft-edge") },
        { browser: "Brave", root: join(base, "BraveSoftware", "Brave-Browser") },
        { browser: "Chromium", root: join(base, "chromium") },
      ];
}

function confined(root: string, candidate: string): string {
  if (lstatSync(candidate).isSymbolicLink())
    throw new Error("Browser import does not follow profile symlinks.");
  const actualRoot = realpathSync(root);
  const actual = realpathSync(candidate);
  const difference = relative(actualRoot, actual);
  if (!difference || difference.startsWith("..") || isAbsolute(difference))
    throw new Error("Browser import source escapes its profile directory.");
  return actual;
}

function boundedFile(root: string, file: string, maximum: number): string {
  if (lstatSync(root).isSymbolicLink())
    throw new Error("Browser import does not follow profile symlinks.");
  const path = confined(root, file);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maximum)
    throw new Error("the file is too large to import safely");
  return path;
}

function relativeInside(base: string, segments: string[]): string {
  return segments.reduce((current, segment) => join(current, segment), base);
}

function probe(
  root: string,
  directory: string,
  segments: string[],
  maximum: number
): { path: string } | { reason: string } {
  const candidate = relativeInside(directory, segments);
  if (!existsSync(candidate)) return { reason: "not stored by this browser" };
  try {
    return { path: boundedFile(root, candidate, maximum) };
  } catch (error) {
    return { reason: (error as Error).message };
  }
}

function snapshotDatabase(source: string, suffixes: string[] = []): string {
  const temporary = mkdtempSync(join(tmpdir(), "cybara-browser-import-"));
  const destination = join(temporary, "snapshot");
  copyFileSync(source, destination);
  for (const suffix of suffixes) {
    const sibling = `${source}${suffix}`;
    if (!existsSync(sibling)) continue;
    try {
      copyFileSync(sibling, `${destination}${suffix}`);
    } catch {
      rmSync(`${destination}${suffix}`, { force: true });
    }
  }
  return destination;
}

function withDatabase<T>(path: string, suffixes: string[], action: (db: Database) => T): T {
  const snapshot = snapshotDatabase(path, suffixes);
  let db: Database | undefined;
  try {
    db = new Database(snapshot, { readonly: true });
    return action(db);
  } finally {
    db?.close();
    rmSync(join(snapshot, ".."), { recursive: true, force: true });
  }
}

interface HistoryRow {
  url: string;
  title: string | null;
  last_visit_time: number;
}

function webUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function readHistory(directory: string): BrowserHistoryEntry[] {
  const source = boundedFile(directory, join(directory, "History"), HISTORY_MAX_BYTES);
  return withDatabase(source, ["-wal", "-shm"], (db) => {
    const rows = db
      .query<HistoryRow, [number]>(
        "SELECT url, title, last_visit_time FROM urls WHERE url LIKE 'http://%' OR url LIKE 'https://%' ORDER BY last_visit_time DESC LIMIT ?"
      )
      .all(BROWSER_IMPORT_MAX_ENTRIES);
    const entries: BrowserHistoryEntry[] = [];
    for (const row of rows) {
      const url = webUrl(row.url ?? "");
      if (!url) continue;
      entries.push({
        url,
        title: (row.title ?? "").slice(0, 4096),
        visited_at: Math.max(0, Math.floor(row.last_visit_time / 1000 - CHROMIUM_EPOCH_OFFSET_MS)),
      });
    }
    return entries;
  });
}

function bookmarkNodes(root: unknown, collected: BrowserBookmark[], depth = 0): void {
  if (depth > 32 || collected.length >= BROWSER_IMPORT_MAX_ENTRIES) return;
  if (Array.isArray(root)) {
    for (const node of root) bookmarkNodes(node, collected, depth + 1);
    return;
  }
  if (!root || typeof root !== "object") return;
  const entry = root as { type?: unknown; url?: unknown; name?: unknown };
  if (entry.type === "url" && typeof entry.url === "string") {
    const url = webUrl(entry.url);
    if (url)
      collected.push({
        url,
        title: typeof entry.name === "string" ? entry.name.slice(0, 4096) : "",
      });
  }
  for (const node of Object.values(root as Record<string, unknown>)) {
    if (node && typeof node === "object") bookmarkNodes(node, collected, depth + 1);
  }
}

function readBookmarks(directory: string): BrowserBookmark[] {
  const file = boundedFile(directory, join(directory, "Bookmarks"), BROWSER_IMPORT_MAX_BYTES);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { roots?: unknown };
  const collected: BrowserBookmark[] = [];
  if (parsed && typeof parsed === "object") bookmarkNodes(parsed.roots, collected);
  const unique = new Map<string, BrowserBookmark>();
  for (const entry of collected) unique.set(entry.url, entry);
  return [...unique.values()].slice(0, BROWSER_IMPORT_MAX_ENTRIES);
}

interface CookieRow {
  host_key: string;
  name: string;
  path: string;
  encrypted_value: string;
  value: string;
  expires_utc: number;
  is_httponly: number;
  is_secure: number;
  samesite: number;
}

const SAME_SITE: BrowserImportCookie["sameSite"][] = ["None", "Lax", "Strict"];
const WEB_TIME_TO_EPOCH_SECONDS = CHROMIUM_EPOCH_OFFSET_MS / 1000;

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/^\./, "");
  if (!trimmed || trimmed.length > 255 || /[\s/\\@]/.test(trimmed)) return "";
  return trimmed;
}

function cookieSelect(): string {
  const columns =
    "host_key, name, path, encrypted_value, value, expires_utc, is_httponly, is_secure, samesite";
  return `SELECT ${columns} FROM cookies ORDER BY last_access_utc DESC LIMIT ?`;
}

function selectCookies(db: Database): CookieRow[] {
  try {
    return db.query<CookieRow, [number]>(cookieSelect()).all(BROWSER_IMPORT_MAX_ENTRIES);
  } catch (error) {
    if (!/no such column/i.test((error as Error).message)) throw error;
    return db
      .query<CookieRow, [number]>(
        "SELECT host_key, name, path, encrypted_value, value, expires_utc, is_httponly, is_secure, samesite FROM cookies LIMIT ?"
      )
      .all(BROWSER_IMPORT_MAX_ENTRIES);
  }
}

function readCookies(
  location: SourceLocation,
  key: ChromiumSecret | undefined
): { entries: BrowserImportCookie[]; notes: string[] } {
  const located = probe(
    location.root,
    location.directory,
    ["Network", "Cookies"],
    LOCAL_DATABASE_MAX_BYTES
  );
  if (!("path" in located)) throw new Error(located.reason);
  const cookies: BrowserImportCookie[] = [];
  const notes = new Set<string>();
  let locked = 0;
  withDatabase(located.path, ["-wal", "-shm"], (db) => {
    const rows = selectCookies(db);
    for (const row of rows) {
      const domain = normalizeHost(row.host_key ?? "");
      if (!domain || typeof row.name !== "string" || !row.name) continue;
      const encoded = row.encrypted_value ?? "";
      let value = row.value ?? "";
      if (encoded.length > 0) {
        const outcome = decryptChromiumValue(encoded, key);
        if (outcome.status === "decrypted" || outcome.status === "plaintext") value = outcome.value;
        else {
          if (locked < MAX_LOCKED_UNLOCKS) {
            locked += 1;
            notes.add(
              `${location.browser}: ${row.name} was skipped: ${outcome.reason}. Sign in again inside Cybara to continue.`
            );
          }
          continue;
        }
      }
      if (!value) continue;
      const expires =
        row.expires_utc > 0
          ? Math.floor(row.expires_utc / 1_000_000 - WEB_TIME_TO_EPOCH_SECONDS)
          : -1;
      cookies.push({
        name: row.name.slice(0, 512),
        value: value.slice(0, 8192),
        domain,
        path: typeof row.path === "string" && row.path ? row.path.slice(0, 512) : "/",
        expires,
        httpOnly: row.is_httponly === 1,
        secure: row.is_secure === 1,
        sameSite: SAME_SITE[row.samesite] ?? "Lax",
      });
      if (cookies.length >= BROWSER_IMPORT_MAX_ENTRIES) break;
    }
  });
  return { entries: cookies, notes: [...notes] };
}

interface LoginRow {
  origin_url: string;
  username_value: string;
  password_value: string;
}

function loginId(origin: string, username: string): string {
  return createHash("sha256").update(`${origin}\0${username}`).digest("hex").slice(0, 32);
}

function readLogins(
  location: SourceLocation,
  key: ChromiumSecret | undefined
): {
  entries: ImportedLogin[];
  notes: string[];
} {
  const located = probe(
    location.root,
    location.directory,
    ["Login Data"],
    LOCAL_DATABASE_MAX_BYTES
  );
  if (!("path" in located)) throw new Error(located.reason);
  const logins: ImportedLogin[] = [];
  const notes = new Set<string>();
  let locked = 0;
  withDatabase(located.path, [], (db) => {
    const rows = db
      .query<LoginRow, [number]>(
        "SELECT origin_url, username_value, password_value FROM logins WHERE password_value != '' AND blacklisted_by_user = 0 ORDER BY origin_url LIMIT ?"
      )
      .all(BROWSER_IMPORT_MAX_ENTRIES);
    for (const row of rows) {
      const raw = row.origin_url ?? "";
      const match = /^([a-z]+):\/\/([^/]+)/i.exec(raw);
      if (!match) continue;
      const protocol = (match[1] ?? "").toLowerCase();
      if (!["http", "https"].includes(protocol)) continue;
      const origin = `${protocol}://${match[2]}`;
      if (origin.includes("@")) continue;
      const outcome = decryptChromiumValue(row.password_value ?? "", key);
      if (outcome.status === "skipped") {
        if (locked < MAX_LOCKED_UNLOCKS) {
          locked += 1;
          notes.add(
            `${location.browser}: some saved passwords were skipped: ${outcome.reason}. Sign in again inside Cybara to continue.`
          );
        }
        continue;
      }
      if (!outcome.value) continue;
      const username = (row.username_value ?? "").slice(0, 4096);
      logins.push({ id: loginId(origin, username), origin, username, password: outcome.value });
      if (logins.length >= BROWSER_IMPORT_MAX_ENTRIES) break;
    }
  });
  return { entries: logins, notes: [...notes] };
}

function keychainAccount(browser: string): string {
  if (browser === "Edge") return "Microsoft Edge Safe Storage";
  if (browser === "Brave") return "Brave Safe Storage";
  if (browser === "Chromium") return "Chromium Safe Storage";
  return "Chrome Safe Storage";
}

function loadEncryptionKey(location: SourceLocation): ChromiumSecret | undefined {
  const stateFile = join(location.userData, "Local State");
  if (!existsSync(stateFile)) return undefined;
  try {
    const bounded = boundedFile(location.root, stateFile, BROWSER_IMPORT_MAX_BYTES);
    const state = JSON.parse(readFileSync(bounded, "utf8")) as {
      os_crypt?: { encrypted_key?: string };
    };
    const encoded = state.os_crypt?.encrypted_key;
    const wrapped =
      typeof encoded === "string" && encoded ? Buffer.from(encoded, "base64") : undefined;
    const outcome = unwrapChromiumKey(wrapped, keychainAccount(location.browser));
    return outcome.status === "unwrapped" ? outcome.secret : undefined;
  } catch {
    return undefined;
  }
}

function hasEncryptionKeyFile(location: SourceLocation): boolean {
  try {
    const file = boundedFile(
      location.userData,
      join(location.userData, "Local State"),
      BROWSER_IMPORT_MAX_BYTES
    );
    const state = JSON.parse(readFileSync(file, "utf8")) as {
      os_crypt?: { encrypted_key?: unknown };
    };
    return (
      typeof state.os_crypt?.encrypted_key === "string" && Boolean(state.os_crypt.encrypted_key)
    );
  } catch {
    return false;
  }
}

function categorize(location: SourceLocation): {
  categories: BrowserImportCategory[];
  availability: BrowserImportCategoryAvailability[];
} {
  const availability: BrowserImportCategoryAvailability[] = [];
  const categories: BrowserImportCategory[] = [];
  const keyAvailable = hasEncryptionKeyFile(location);
  for (const [category, segments, maximum] of [
    ["history", ["History"], HISTORY_MAX_BYTES],
    ["bookmarks", ["Bookmarks"], BROWSER_IMPORT_MAX_BYTES],
    ["cookies", ["Network", "Cookies"], LOCAL_DATABASE_MAX_BYTES],
    ["passwords", ["Login Data"], LOCAL_DATABASE_MAX_BYTES],
  ] as const) {
    const found = probe(location.root, location.directory, [...segments], maximum);
    const needsKey = category === "cookies" || category === "passwords";
    if (!("path" in found)) {
      availability.push({ category, available: false, reason: found.reason });
      continue;
    }
    categories.push(category);
    availability.push(
      needsKey && !keyAvailable
        ? {
            category,
            available: false,
            reason:
              "This browser stores these values encrypted and no readable key was found. Only the browser itself can open them.",
          }
        : { category, available: true }
    );
  }
  return { categories, availability };
}

function discover(options: BrowserImportDiscoveryOptions): SourceLocation[] {
  const found: SourceLocation[] = [];
  for (const { browser, root } of discoveryRoots(options)) {
    if (!existsSync(root) || lstatSync(root).isSymbolicLink()) continue;
    let entries: string[];
    try {
      entries = readdirSync(root)
        .filter((entry) => /^(Default|Profile \d+)$/.test(entry))
        .slice(0, MAX_PROFILES_PER_ROOT);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const directory = confined(root, join(root, entry));
        if (!statSync(directory).isDirectory()) continue;
        const userData = realpathSync(root);
        const probeLocation: SourceLocation = {
          source: {
            id: "",
            browser,
            profile: entry === "Default" ? "Default" : entry,
            categories: [],
          },
          root,
          directory,
          userData,
          browser,
        };
        const { categories, availability } = categorize(probeLocation);
        if (categories.length === 0) continue;
        found.push({
          ...probeLocation,
          source: {
            id: createHash("sha256").update(directory).digest("hex"),
            browser,
            profile: entry === "Default" ? "Default profile" : entry,
            categories,
          },
        });
        void availability;
      } catch {
        continue;
      }
    }
  }
  return found;
}

export function detectBrowserImportProfiles(
  options: BrowserImportDiscoveryOptions = {}
): BrowserImportProfile[] {
  const result: BrowserImportProfile[] = [];
  for (const location of discover(options)) {
    const { availability } = categorize(location);
    result.push({ ...location.source, availability, locked: [] });
  }
  return result;
}

function readProfileSync(location: SourceLocation): BrowserProfileReadResult {
  const data = emptyData();
  const locked: BrowserImportCategory[] = [];
  const notes = new Set<string>();
  const key = loadEncryptionKey(location);

  const read = <C extends BrowserImportCategory>(
    category: C,
    action: () => { entries: BrowserProfileData[C]; notes: string[] }
  ): { entries: BrowserProfileData[C]; notes: string[] } => {
    try {
      return action();
    } catch (error) {
      const message = (error as Error).message;
      if (isConfinementViolation(message)) throw error;
      if (/EBUSY|locked|busy|in use/i.test(message)) locked.push(category);
      else
        notes.add(`${location.browser}: ${category} could not be read (${message.slice(0, 120)}).`);
      return { entries: [] as BrowserProfileData[C], notes: [] };
    }
  };

  const apply = <C extends BrowserImportCategory>(
    category: C,
    action: () => { entries: BrowserProfileData[C]; notes: string[] },
    assign: (entries: BrowserProfileData[C]) => void
  ): void => {
    const result = read(category, action);
    assign(result.entries);
    for (const note of result.notes) notes.add(note);
  };

  if (location.source.categories.includes("history"))
    apply(
      "history",
      () => ({ entries: readHistory(location.directory), notes: [] }),
      (entries) => {
        data.history = entries;
      }
    );
  if (location.source.categories.includes("bookmarks"))
    apply(
      "bookmarks",
      () => ({ entries: readBookmarks(location.directory), notes: [] }),
      (entries) => {
        data.bookmarks = entries;
      }
    );
  if (location.source.categories.includes("cookies"))
    apply(
      "cookies",
      () => readCookies(location, key),
      (entries) => {
        data.cookies = entries;
      }
    );
  if (location.source.categories.includes("passwords"))
    apply(
      "passwords",
      () => readLogins(location, key),
      (entries) => {
        data.passwords = entries;
      }
    );
  return { data, locked, notes: [...notes] };
}

export function readBrowserImportProfile(
  id: string,
  options: BrowserImportDiscoveryOptions = {}
): BrowserProfileReadResult {
  const location = discover(options).find((entry) => entry.source.id === id);
  if (!location)
    throw new Error("Browser profile is no longer available. Refresh the browser list.");
  return readProfileSync(location);
}

export function readAllBrowserImportProfiles(options: BrowserImportDiscoveryOptions = {}): {
  data: BrowserProfileData;
  locked: BrowserImportCategory[];
  notes: string[];
  profiles: number;
} {
  const merged = emptyData();
  const locked = new Set<BrowserImportCategory>();
  const notes = new Set<string>();
  let profiles = 0;
  const seenKeys = new Set<string>();
  const take = <T>(target: T[], source: T[], identity: (entry: T) => string): void => {
    for (const entry of source) {
      const key = identity(entry);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      target.push(entry);
      if (target.length >= BROWSER_IMPORT_MAX_ENTRIES) return;
    }
  };
  for (const location of discover(options)) {
    profiles += 1;
    const result = readProfileSync(location);
    take(merged.passwords, result.data.passwords, (entry) => entry.id);
    take(
      merged.cookies,
      result.data.cookies,
      (entry) => `${entry.domain} ${entry.path} ${entry.name}`
    );
    take(merged.history, result.data.history, (entry) => entry.url);
    take(merged.bookmarks, result.data.bookmarks, (entry) => entry.url);
    for (const category of result.locked) locked.add(category);
    for (const note of result.notes) notes.add(note);
  }
  return { data: merged, locked: [...locked], notes: [...notes], profiles };
}
