import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectBrowserImportSources,
  readBrowserImportSource,
} from "../../src/core/browser/import-sources";

const roots: string[] = [];
function fixture(): {
  home: string;
  directory: string;
  options: { platform: "win32"; home: string; env: NodeJS.ProcessEnv };
} {
  const home = mkdtempSync(join(tmpdir(), "cybara-import-source-"));
  roots.push(home);
  const local = join(home, "Local");
  const directory = join(local, "Google", "Chrome", "User Data", "Default");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: { children: [{ type: "url", name: "Home", url: "https://example.test" }] },
      },
    })
  );
  const db = new Database(join(directory, "History"));
  db.exec("CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)");
  db.query("INSERT INTO urls VALUES (?, ?, ?)").run(
    "https://example.test/path",
    "Fixture visit",
    (1000 + 11644473600000) * 1000
  );
  db.close();
  return { home, directory, options: { platform: "win32", home, env: { LOCALAPPDATA: local } } };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local browser source discovery", () => {
  test("detects supported categories with opaque ids and imports without changing source files", async () => {
    const { directory, options } = fixture();
    const beforeHistory = readFileSync(join(directory, "History"));
    const beforeBookmarks = readFileSync(join(directory, "Bookmarks"));
    const sources = await detectBrowserImportSources(options);
    expect(sources).toHaveLength(1);
    const source = sources[0];
    if (!source) throw new Error("Missing source");
    expect(source).toMatchObject({ browser: "Chrome", categories: ["history", "bookmarks"] });
    expect(source.id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(source)).not.toContain(directory);
    const data = await readBrowserImportSource(source.id, ["history", "bookmarks"], options);
    expect(data.history).toEqual([
      { url: "https://example.test/path", title: "Fixture visit", visited_at: 1000 },
    ]);
    expect(data.bookmarks).toEqual([{ url: "https://example.test/", title: "Home" }]);
    expect(data.passwords).toEqual([]);
    expect(data.cookies).toEqual([]);
    expect(readFileSync(join(directory, "History"))).toEqual(beforeHistory);
    expect(readFileSync(join(directory, "Bookmarks"))).toEqual(beforeBookmarks);
    await expect(readBrowserImportSource(source.id, ["passwords"], options)).rejects.toThrow(
      "exported file"
    );
    await expect(readBrowserImportSource("../../private", ["history"], options)).rejects.toThrow(
      "no longer available"
    );
  });

  test("rejects profile and source-file symlink escapes", async () => {
    const { home, directory, options } = fixture();
    const outside = join(home, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "Bookmarks"), "{}");
    const userData = join(directory, "..");
    symlinkSync(outside, join(userData, "Profile 9"), "junction");
    expect(await detectBrowserImportSources(options)).toHaveLength(1);
    const source = (await detectBrowserImportSources(options))[0];
    if (!source) throw new Error("Missing source");
    rmSync(join(directory, "Bookmarks"));
    symlinkSync(join(outside, "Bookmarks"), join(directory, "Bookmarks"), "file");
    await expect(readBrowserImportSource(source.id, ["bookmarks"], options)).rejects.toThrow();
  });

  test("reads live WAL history with private temporary snapshot cleanup", async () => {
    const { directory, options } = fixture();
    const db = new Database(join(directory, "History"));
    db.exec("PRAGMA journal_mode=WAL");
    db.query("INSERT INTO urls VALUES (?, ?, ?)").run(
      "https://wal.test",
      "Live WAL",
      (2000 + 11644473600000) * 1000
    );
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("cybara-browser-history-")
    );
    try {
      const source = (await detectBrowserImportSources(options))[0];
      if (!source) throw new Error("Missing source");
      const data = await readBrowserImportSource(source.id, ["history"], options);
      expect(data.history[0]).toEqual({
        url: "https://wal.test/",
        title: "Live WAL",
        visited_at: 2000,
      });
    } finally {
      db.close();
    }
    expect(
      readdirSync(tmpdir()).filter((name) => name.startsWith("cybara-browser-history-"))
    ).toEqual(before);
  });
});
