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
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  BrowserImportCategory,
  BrowserImportData,
  BrowserImportSource,
} from "../../../shared/browser-import";
import {
  BROWSER_IMPORT_MAX_BYTES,
  BROWSER_IMPORT_MAX_ENTRIES,
  parseBrowserImportFile,
} from "./import-parsers";

export interface BrowserImportDiscoveryOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

interface SourceLocation {
  source: BrowserImportSource;
  root: string;
  directory: string;
}

function roots(options: BrowserImportDiscoveryOptions): Array<{ browser: string; root: string }> {
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
    throw new Error("Browser import source is too large or unavailable.");
  return path;
}

function discover(options: BrowserImportDiscoveryOptions): SourceLocation[] {
  const result: SourceLocation[] = [];
  for (const { browser, root } of roots(options)) {
    if (!existsSync(root) || lstatSync(root).isSymbolicLink()) continue;
    let entries: string[];
    try {
      entries = readdirSync(root)
        .filter((entry) => /^(Default|Profile \d+)$/.test(entry))
        .slice(0, 50);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const directory = confined(root, join(root, entry));
        if (!statSync(directory).isDirectory()) continue;
        const categories: BrowserImportCategory[] = [];
        for (const [file, category] of [
          ["History", "history"],
          ["Bookmarks", "bookmarks"],
        ] as const) {
          if (existsSync(join(directory, file))) {
            boundedFile(
              directory,
              join(directory, file),
              category === "history" ? 512 * 1024 * 1024 : BROWSER_IMPORT_MAX_BYTES
            );
            categories.push(category);
          }
        }
        if (categories.length === 0) continue;
        const id = createHash("sha256").update(resolve(directory)).digest("hex");
        result.push({
          source: {
            id,
            browser,
            profile: entry === "Default" ? "Default profile" : entry,
            categories,
          },
          root,
          directory,
        });
      } catch {
        continue;
      }
    }
  }
  return result;
}

export async function detectBrowserImportSources(
  options: BrowserImportDiscoveryOptions = {}
): Promise<BrowserImportSource[]> {
  return discover(options).map(({ source }) => source);
}

function history(directory: string): BrowserImportData["history"] {
  const source = boundedFile(directory, join(directory, "History"), 512 * 1024 * 1024);
  const temporary = mkdtempSync(join(tmpdir(), "cybara-browser-history-"));
  let db: Database | undefined;
  try {
    const destination = join(temporary, "History");
    copyFileSync(source, destination);
    for (const suffix of ["-wal", "-shm"]) {
      const sibling = `${source}${suffix}`;
      if (existsSync(sibling))
        copyFileSync(boundedFile(directory, sibling, 128 * 1024 * 1024), `${destination}${suffix}`);
    }
    db = new Database(destination, { readonly: true });
    const entries = db
      .query<{ url: string; title: string; last_visit_time: number }, [number]>(
        "SELECT url, title, last_visit_time FROM urls WHERE url LIKE 'http://%' OR url LIKE 'https://%' ORDER BY last_visit_time DESC LIMIT ?"
      )
      .all(BROWSER_IMPORT_MAX_ENTRIES);
    return parseBrowserImportFile(
      "history",
      JSON.stringify(
        entries.map((entry) => ({
          url: entry.url,
          title: entry.title ?? "",
          visited_at: Math.max(0, Math.floor(entry.last_visit_time / 1000 - 11644473600000)),
        }))
      )
    ).history;
  } catch {
    throw new Error("Browsing history could not be read. Close the source browser and try again.");
  } finally {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function readBrowserImportSource(
  id: string,
  categories: BrowserImportCategory[],
  options: BrowserImportDiscoveryOptions = {}
): Promise<BrowserImportData> {
  const location = discover(options).find((entry) => entry.source.id === id);
  if (!location)
    throw new Error("Browser profile is no longer available. Refresh the browser list.");
  if (categories.some((category) => !location.source.categories.includes(category)))
    throw new Error(
      "The selected data is not available from this browser profile. Use an exported file instead."
    );
  const data: BrowserImportData = { passwords: [], cookies: [], history: [], bookmarks: [] };
  if (categories.includes("history")) data.history = history(location.directory);
  if (categories.includes("bookmarks")) {
    const file = boundedFile(
      location.directory,
      join(location.directory, "Bookmarks"),
      BROWSER_IMPORT_MAX_BYTES
    );
    data.bookmarks = parseBrowserImportFile("bookmarks", readFileSync(file, "utf8")).bookmarks;
  }
  return data;
}
