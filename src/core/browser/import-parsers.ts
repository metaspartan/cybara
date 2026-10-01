import { createHash } from "node:crypto";
import type {
  BrowserBookmark,
  BrowserImportCategory,
  BrowserImportCookie,
  BrowserImportData,
  ImportedLogin,
} from "../../../shared/browser-import";

export const BROWSER_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const BROWSER_IMPORT_MAX_ENTRIES = 10_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser import record.");
  return value as Record<string, unknown>;
}

function string(value: unknown, limit = 65_536): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error("Invalid or oversized browser import value.");
  return value;
}

function webUrl(value: unknown): URL {
  let url: URL;
  try {
    url = new URL(string(value, 8192));
  } catch {
    throw new Error("Import URLs must be valid HTTP or HTTPS addresses.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Import URLs must be HTTP or HTTPS without embedded credentials.");
  return url;
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > BROWSER_IMPORT_MAX_ENTRIES)
    throw new Error("Import must be a list of no more than 10,000 entries.");
  return value;
}

function csvRows(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closed) throw new Error("Invalid password CSV quoting.");
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        if (row.some((value) => value.length > 0)) result.push(row);
        row = [];
        if (result.length > BROWSER_IMPORT_MAX_ENTRIES + 1)
          throw new Error("Password import exceeds 10,000 entries.");
      }
    } else {
      if (closed) throw new Error("Invalid characters after quoted CSV field.");
      field += char;
    }
  }
  if (quoted) throw new Error("Password CSV has an unterminated quoted field.");
  if (field || row.length || closed) {
    row.push(field);
    result.push(row);
  }
  return result;
}

function passwords(text: string): ImportedLogin[] {
  const parsed = csvRows(text.replace(/^\uFEFF/, ""));
  const header = parsed.shift()?.map((value) => value.trim().toLowerCase());
  if (!header) throw new Error("Password CSV is empty.");
  const urlIndex = header.indexOf("url");
  const usernameIndex = header.indexOf("username");
  const passwordIndex = header.indexOf("password");
  if ([urlIndex, usernameIndex, passwordIndex].some((index) => index < 0))
    throw new Error("Password CSV must include url, username and password columns.");
  if (parsed.length > BROWSER_IMPORT_MAX_ENTRIES)
    throw new Error("Password import exceeds 10,000 entries.");
  return parsed.map((row) => {
    if (row.length !== header.length)
      throw new Error("Password CSV row has an unexpected number of columns.");
    const origin = webUrl(row[urlIndex]).origin;
    const username = string(row[usernameIndex], 4096);
    const password = string(row[passwordIndex]);
    if (!password) throw new Error("Password CSV contains an empty password.");
    return {
      id: createHash("sha256").update(`${origin}\0${username}`).digest("hex"),
      origin,
      username,
      password,
    };
  });
}

function cookie(value: unknown): BrowserImportCookie {
  const row = record(value);
  const name = string(row.name, 4096);
  const valueText = string(row.value);
  const domain = string(row.domain, 253).toLowerCase();
  const path = row.path === undefined ? "/" : string(row.path, 4096);
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
    !/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    domain.includes("..") ||
    !path.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(path + valueText)
  )
    throw new Error("Cookie export contains an invalid name, domain, path or value.");
  const rawExpiry = row.expires ?? row.expirationDate ?? -1;
  if (typeof rawExpiry !== "number" || !Number.isFinite(rawExpiry) || rawExpiry < -1)
    throw new Error("Cookie expiry must be a finite Unix timestamp.");
  const expires = row.session === true || rawExpiry === 0 ? -1 : rawExpiry;
  for (const key of ["secure", "httpOnly", "session"])
    if (row[key] !== undefined && typeof row[key] !== "boolean")
      throw new Error("Cookie flags must be booleans.");
  const secure = row.secure === true;
  const httpOnly = row.httpOnly === true;
  const normalizedSameSite = typeof row.sameSite === "string" ? row.sameSite.toLowerCase() : "lax";
  const sameSite =
    normalizedSameSite === "strict"
      ? "Strict"
      : ["none", "no_restriction"].includes(normalizedSameSite)
        ? "None"
        : ["lax", "unspecified"].includes(normalizedSameSite)
          ? "Lax"
          : null;
  if (!sameSite || (sameSite === "None" && !secure))
    throw new Error("Cookie SameSite=None requires Secure.");
  if (
    (name.startsWith("__Secure-") && !secure) ||
    (name.startsWith("__Host-") && (!secure || path !== "/" || domain.startsWith(".")))
  )
    throw new Error("Cookie security prefix requirements are not satisfied.");
  return { name, value: valueText, domain, path, expires, httpOnly, secure, sameSite };
}

function cookies(text: string): BrowserImportCookie[] {
  let values: unknown[];
  if (/^[\s]*[\[{]/.test(text)) {
    const json = JSON.parse(text) as unknown;
    values = rows(Array.isArray(json) ? json : record(json).cookies);
  } else {
    values = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
      const fields = line.replace(/^#HttpOnly_/, "").split("\t");
      if (fields.length !== 7)
        throw new Error("Netscape cookie exports must contain seven tab-separated columns.");
      const [domain, includeSubdomains, path, secure, expiry, name, value] = fields;
      if (
        !["TRUE", "FALSE"].includes(includeSubdomains ?? "") ||
        !["TRUE", "FALSE"].includes(secure ?? "")
      )
        throw new Error("Invalid Netscape cookie flags.");
      values.push({
        domain,
        path,
        secure: secure === "TRUE",
        expires: Number(expiry),
        name,
        value,
        httpOnly: line.startsWith("#HttpOnly_"),
      });
      if (values.length > BROWSER_IMPORT_MAX_ENTRIES)
        throw new Error("Cookie import exceeds 10,000 entries.");
    }
  }
  return values
    .map(cookie)
    .filter((entry) => entry.expires === -1 || entry.expires > Date.now() / 1000);
}

function decodeHtml(text: string): string {
  return text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
    };
    const match = named[entity.toLowerCase()];
    if (match !== undefined) return match;
    const number = entity.toLowerCase().startsWith("&#x")
      ? parseInt(entity.slice(3, -1), 16)
      : parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  });
}

function bookmarks(text: string): BrowserBookmark[] {
  const result: BrowserBookmark[] = [];
  const add = (url: unknown, title: unknown): void => {
    result.push({ url: webUrl(url).href, title: string(title ?? "", 4096) });
    if (result.length > BROWSER_IMPORT_MAX_ENTRIES)
      throw new Error("Bookmark import exceeds 10,000 entries.");
  };
  if (text.trimStart().startsWith("<")) {
    for (const match of text.matchAll(
      /<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
    )) {
      add(
        decodeHtml(match[1] ?? match[2] ?? ""),
        decodeHtml((match[3] ?? "").replace(/<[^>]*>/g, ""))
      );
    }
    if (result.length === 0) throw new Error("No bookmarks found in this HTML export.");
    return result;
  }
  const json = JSON.parse(text) as unknown;
  if (Array.isArray(json)) {
    for (const value of rows(json)) {
      const entry = record(value);
      add(entry.url, entry.title ?? entry.name);
    }
    return result;
  }
  const roots = record(record(json).roots);
  const pending = Object.values(roots);
  let examined = 0;
  while (pending.length > 0) {
    if (++examined > 50_000) throw new Error("Bookmark tree is too large.");
    const entry = record(pending.pop());
    if (entry.type === "url" || entry.url !== undefined) add(entry.url, entry.name ?? entry.title);
    if (entry.children !== undefined) pending.push(...rows(entry.children));
  }
  return result;
}

export function parseBrowserImportFile(
  category: BrowserImportCategory,
  text: string
): BrowserImportData {
  if (Buffer.byteLength(text, "utf8") > BROWSER_IMPORT_MAX_BYTES)
    throw new Error("Each browser import file must be 8 MB or smaller.");
  if (!text.trim()) throw new Error("The selected import file is empty.");
  const data: BrowserImportData = { passwords: [], cookies: [], history: [], bookmarks: [] };
  if (category === "passwords") data.passwords = passwords(text);
  else if (category === "cookies") data.cookies = cookies(text);
  else if (category === "bookmarks") data.bookmarks = bookmarks(text);
  else if (category === "history") {
    data.history = rows(JSON.parse(text) as unknown).map((value) => {
      const entry = record(value);
      const visited_at = entry.visited_at ?? entry.lastVisitTime ?? 0;
      if (typeof visited_at !== "number" || !Number.isFinite(visited_at) || visited_at < 0)
        throw new Error("History timestamps must be non-negative epoch milliseconds.");
      return { url: webUrl(entry.url).href, title: string(entry.title ?? "", 4096), visited_at };
    });
  } else throw new Error("Unsupported browser import category.");
  return data;
}
