import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserImportCookie,
  BrowserImportData,
  ImportedLogin,
} from "../../../shared/browser-import";
import { configDir } from "../paths";
import { isSealedSecret, openSecret, sealSecret } from "../secret-storage";

export interface BrowserImportCounts {
  passwords: number;
  cookies: number;
  history: number;
  bookmarks: number;
}

export interface BrowserImportLibrary {
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
  logins: Array<Pick<ImportedLogin, "id" | "origin" | "username">>;
}

interface StoredBrowserImport {
  version: 1;
  data: BrowserImportData;
}

const MAX_STORED_ENTRIES = 10_000;
const SECRET_CONTEXT = "browser-import:data";

function emptyData(): BrowserImportData {
  return { passwords: [], cookies: [], history: [], bookmarks: [] };
}

function mergeRecords<T>(oldRecords: T[], newRecords: T[], key: (entry: T) => string): T[] {
  const records = new Map<string, T>();
  for (const entry of [...oldRecords, ...newRecords]) records.set(key(entry), entry);
  return [...records.values()].slice(-MAX_STORED_ENTRIES);
}

export class BrowserImportStore {
  private readonly directory: string;
  private readonly file: string;

  constructor(root: string = configDir) {
    this.directory = join(root, "browser", "imported");
    this.file = join(this.directory, "data.enc");
  }

  private read(): BrowserImportData {
    if (!existsSync(this.file)) return emptyData();
    if (statSync(this.file).size > 48 * 1024 * 1024)
      throw new Error("Imported browser data exceeds the storage limit.");
    const encrypted = readFileSync(this.file, "utf8");
    if (!isSealedSecret(encrypted)) throw new Error("Imported browser data must be encrypted.");
    const value = JSON.parse(openSecret(encrypted, SECRET_CONTEXT)) as StoredBrowserImport;
    if (
      value.version !== 1 ||
      !value.data ||
      !["passwords", "cookies", "history", "bookmarks"].every((key) =>
        Array.isArray(value.data[key as keyof BrowserImportData])
      )
    ) {
      throw new Error("Imported browser data could not be read. The encrypted store is invalid.");
    }
    return value.data;
  }

  counts(): BrowserImportCounts {
    const data = this.read();
    return {
      passwords: data.passwords.length,
      cookies: data.cookies.length,
      history: data.history.length,
      bookmarks: data.bookmarks.length,
    };
  }

  library(): BrowserImportLibrary {
    const data = this.read();
    return {
      history: data.history
        .slice()
        .sort((a, b) => b.visited_at - a.visited_at)
        .slice(0, 500),
      bookmarks: data.bookmarks.slice(0, 500),
      logins: data.passwords.map(({ id, origin, username }) => ({ id, origin, username })),
    };
  }

  cookies(): BrowserImportCookie[] {
    const now = Date.now() / 1000;
    return this.read().cookies.filter((cookie) => cookie.expires === -1 || cookie.expires > now);
  }

  login(id: string): ImportedLogin | undefined {
    return this.read().passwords.find((login) => login.id === id);
  }

  import(data: BrowserImportData): BrowserImportCounts {
    const previous = this.read();
    const merged: BrowserImportData = {
      passwords: mergeRecords(
        previous.passwords,
        data.passwords,
        (entry) => `${entry.origin}\0${entry.username}`
      ),
      cookies: mergeRecords(
        previous.cookies,
        data.cookies,
        (entry) => `${entry.domain}\0${entry.path}\0${entry.name}`
      ),
      history: mergeRecords(previous.history, data.history, (entry) => entry.url).sort(
        (a, b) => a.visited_at - b.visited_at
      ),
      bookmarks: mergeRecords<BrowserBookmark>(
        previous.bookmarks,
        data.bookmarks,
        (entry) => entry.url
      ),
    };
    const plaintext = JSON.stringify({ version: 1, data: merged });
    if (Buffer.byteLength(plaintext, "utf8") > 32 * 1024 * 1024)
      throw new Error("The imported browser library exceeds the 32 MB storage limit.");
    const serialized = sealSecret(plaintext, SECRET_CONTEXT);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
    return {
      passwords: data.passwords.length,
      cookies: data.cookies.length,
      history: data.history.length,
      bookmarks: data.bookmarks.length,
    };
  }
}

export const browserImportStore = new BrowserImportStore();
