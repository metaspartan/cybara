import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
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
import { decryptChromiumValue } from "../../src/core/browser/chromium-secrets";
import {
  detectBrowserImportProfiles,
  readAllBrowserImportProfiles,
  readBrowserImportProfile,
} from "../../src/core/browser/chromium-profiles";

const roots: string[] = [];
const CHROMIUM_EPOCH_OFFSET_MS = 11_644_473_600_000;

function aesEncrypt(key: Buffer, value: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), iv, body]).toString("base64");
}

function fixture(): {
  home: string;
  directory: string;
  options: { platform: "win32"; home: string; env: NodeJS.ProcessEnv };
} {
  const home = mkdtempSync(join(tmpdir(), "cybara-import-profile-"));
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
  const history = new Database(join(directory, "History"));
  history.exec("CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)");
  history
    .query("INSERT INTO urls VALUES (?, ?, ?)")
    .run("https://example.test/path", "Fixture visit", (1000 + CHROMIUM_EPOCH_OFFSET_MS) * 1000);
  history.close();
  return { home, directory, options: { platform: "win32", home, env: { LOCALAPPDATA: local } } };
}

function writeLocalState(userData: string, key: Buffer): void {
  writeFileSync(
    join(userData, "Local State"),
    JSON.stringify({ os_crypt: { encrypted_key: key.toString("base64") } })
  );
}

function addCookies(directory: string, key: Buffer): void {
  mkdirSync(join(directory, "Network"), { recursive: true });
  const db = new Database(join(directory, "Network", "Cookies"));
  db.exec(
    "CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_httponly INTEGER, is_secure INTEGER, samesite INTEGER)"
  );
  const insert = db.query(
    "INSERT INTO cookies (host_key,name,value,encrypted_value,path,expires_utc,is_httponly,is_secure,samesite) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  const expires = Math.floor(
    (Date.now() / 1000 + 86_400 + CHROMIUM_EPOCH_OFFSET_MS / 1000) * 1_000_000
  );
  insert.run(
    ".example.test",
    "session",
    "",
    aesEncrypt(key, "cookie-value"),
    "/",
    expires,
    1,
    1,
    1
  );
  insert.run(".example.test", "legacy", "plain-value", "", "/", expires, 0, 0, 0);
  db.close();
}

function addLogins(directory: string, key: Buffer): void {
  const db = new Database(join(directory, "Login Data"));
  db.exec(
    "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value TEXT, blacklisted_by_user INTEGER)"
  );
  db.query("INSERT INTO logins VALUES (?,?,?,0)").run(
    "https://accounts.example.test/login",
    "fixture-user",
    aesEncrypt(key, "fixture-password")
  );
  db.close();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local browser profile discovery", () => {
  test("detects categories with opaque ids and imports without changing source files", () => {
    const { directory, options } = fixture();
    const beforeHistory = readFileSync(join(directory, "History"));
    const beforeBookmarks = readFileSync(join(directory, "Bookmarks"));
    const profiles = detectBrowserImportProfiles(options);
    expect(profiles).toHaveLength(1);
    const profile = profiles[0];
    if (!profile) throw new Error("Missing profile");
    expect(profile).toMatchObject({ browser: "Chrome", categories: ["history", "bookmarks"] });
    expect(profile.id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(profile)).not.toContain(directory);
    const data = readBrowserImportProfile(profile.id, options);
    expect(data.data.history).toEqual([
      { url: "https://example.test/path", title: "Fixture visit", visited_at: 1000 },
    ]);
    expect(data.data.bookmarks).toEqual([{ url: "https://example.test/", title: "Home" }]);
    expect(data.data.passwords).toEqual([]);
    expect(data.data.cookies).toEqual([]);
    expect(readFileSync(join(directory, "History"))).toEqual(beforeHistory);
    expect(readFileSync(join(directory, "Bookmarks"))).toEqual(beforeBookmarks);
  });

  test("rejects profile and source-file symlink escapes", () => {
    const { home, directory, options } = fixture();
    const outside = join(home, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "Bookmarks"), "{}");
    const userData = join(directory, "..");
    symlinkSync(outside, join(userData, "Profile 9"), "junction");
    expect(detectBrowserImportProfiles(options)).toHaveLength(1);
    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    rmSync(join(directory, "Bookmarks"));
    symlinkSync(join(outside, "Bookmarks"), join(directory, "Bookmarks"), "file");
    const after = detectBrowserImportProfiles(options)[0];
    if (!after) throw new Error("Missing profile");
    expect(after.categories).not.toContain("bookmarks");
  });

  test("reads live WAL history with private temporary snapshot cleanup", () => {
    const { directory, options } = fixture();
    const db = new Database(join(directory, "History"));
    db.exec("PRAGMA journal_mode=WAL");
    db.query("INSERT INTO urls VALUES (?, ?, ?)").run(
      "https://wal.test",
      "Live WAL",
      (2000 + CHROMIUM_EPOCH_OFFSET_MS) * 1000
    );
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("cybara-browser-history-")
    );
    try {
      const profile = detectBrowserImportProfiles(options)[0];
      if (!profile) throw new Error("Missing profile");
      const result = readBrowserImportProfile(profile.id, options);
      expect(result.data.history[0]).toEqual({
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

  test("rejects an unknown profile id", () => {
    const { options } = fixture();
    expect(() => readBrowserImportProfile("../../private", options)).toThrow("no longer available");
  });
});

describe("automatic credential and cookie import", () => {
  test("reads cookies and saved logins straight from the profile", () => {
    const { directory, options } = fixture();
    const key = randomBytes(32);
    writeLocalState(join(directory, ".."), key);
    addCookies(directory, key);
    addLogins(directory, key);

    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    expect(profile.categories).toContain("cookies");
    expect(profile.categories).toContain("passwords");

    const result = readBrowserImportProfile(profile.id, options);
    const session = result.data.cookies.find((cookie) => cookie.name === "session");
    expect(session).toMatchObject({
      domain: "example.test",
      value: "cookie-value",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(result.data.cookies.some((cookie) => cookie.name === "legacy")).toBe(true);
    expect(result.data.passwords).toHaveLength(1);
    expect(result.data.passwords[0]).toMatchObject({
      origin: "https://accounts.example.test",
      username: "fixture-user",
      password: "fixture-password",
    });
  });

  test("imports every discovered profile in one pass without manual selection", () => {
    const { home, directory, options } = fixture();
    const key = randomBytes(32);
    writeLocalState(join(directory, ".."), key);
    addCookies(directory, key);
    const second = join(home, "Local", "Microsoft", "Edge", "User Data", "Profile 2");
    mkdirSync(second, { recursive: true });
    writeFileSync(
      join(second, "Bookmarks"),
      JSON.stringify({
        roots: { other: { children: [{ type: "url", name: "Edge", url: "https://edge.test/" }] } },
      })
    );
    expect(detectBrowserImportProfiles(options).length).toBe(2);

    const all = readAllBrowserImportProfiles(options);
    expect(all.profiles).toBe(2);
    expect(all.data.cookies.some((cookie) => cookie.name === "session")).toBe(true);
    expect(all.data.bookmarks.map((entry) => entry.url).sort()).toEqual([
      "https://edge.test/",
      "https://example.test/",
    ]);
    expect(all.locked).toEqual([]);
  });

  test("reports cookies and logins as unavailable when no browser key is readable", () => {
    const { directory, options } = fixture();
    const key = randomBytes(32);
    addCookies(directory, key);
    addLogins(directory, key);

    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    const unavailable = profile.availability.filter((entry) => !entry.available);
    expect(unavailable.map((entry) => entry.category).sort()).toEqual(["cookies", "passwords"]);
    for (const entry of unavailable) expect(entry.reason).toBeTruthy();

    const result = readBrowserImportProfile(profile.id, options);
    expect(result.data.cookies.map((cookie) => cookie.name)).toEqual(["legacy"]);
    expect(result.data.cookies[0]?.value).toBe("plain-value");
    expect(result.data.passwords).toEqual([]);
    expect(result.notes.some((note) => note.includes("app-bound") || note.includes("key"))).toBe(
      true
    );
  });

  test("app-bound encrypted values are skipped instead of imported as garbage", () => {
    const { directory, options } = fixture();
    writeLocalState(join(directory, ".."), randomBytes(32));
    mkdirSync(join(directory, "Network"), { recursive: true });
    const db = new Database(join(directory, "Network", "Cookies"));
    db.exec(
      "CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_httponly INTEGER, is_secure INTEGER, samesite INTEGER)"
    );
    db.query(
      "INSERT INTO cookies (host_key,name,value,encrypted_value,path,expires_utc,is_httponly,is_secure,samesite) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(
      ".example.test",
      "bound",
      "",
      Buffer.concat([Buffer.from("v20"), randomBytes(64)]).toString("base64"),
      "/",
      1,
      0,
      1,
      1
    );
    db.close();

    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    const result = readBrowserImportProfile(profile.id, options);
    expect(result.data.cookies).toEqual([]);
    expect(result.notes.join(" ")).toContain("app-bound");
  });

  test("an unreadable database degrades to skipped data rather than failing the whole import", () => {
    const { directory, options } = fixture();
    const key = randomBytes(32);
    writeLocalState(join(directory, ".."), key);
    addCookies(directory, key);
    addLogins(directory, key);
    writeFileSync(join(directory, "Network", "Cookies"), Buffer.from("not a sqlite database"));

    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    const result = readBrowserImportProfile(profile.id, options);
    expect(result.data.history.length).toBeGreaterThan(0);
    expect(result.data.cookies).toEqual([]);
    const reported =
      result.locked.includes("cookies") || result.notes.some((note) => note.includes("cookies"));
    expect(reported).toBe(true);
  });

  test("a missing category degrades instead of aborting the other categories", () => {
    const { directory, options } = fixture();
    const key = randomBytes(32);
    writeLocalState(join(directory, ".."), key);
    addCookies(directory, key);
    rmSync(join(directory, "Bookmarks"));

    const profile = detectBrowserImportProfiles(options)[0];
    if (!profile) throw new Error("Missing profile");
    const result = readBrowserImportProfile(profile.id, options);
    expect(result.data.history.length).toBeGreaterThan(0);
    expect(result.data.cookies.length).toBeGreaterThan(0);
    expect(result.data.bookmarks).toEqual([]);
  });
});

describe("chromium value decryption", () => {
  test("round-trips an AES-CBC value and strips padding", () => {
    const key = randomBytes(32);
    const encoded = aesEncrypt(key, "hello-value");
    expect(decryptChromiumValue(encoded, key)).toEqual({
      status: "decrypted",
      value: "hello-value",
    });
  });

  test("passes through plaintext, rejects bad keys, and explains app-bound values", () => {
    expect(
      decryptChromiumValue(Buffer.from("plain", "utf8").toString("base64"), randomBytes(32))
    ).toEqual({ status: "plaintext", value: "plain" });
    const appBound = decryptChromiumValue(
      Buffer.concat([Buffer.from("v20"), randomBytes(64)]).toString("base64"),
      randomBytes(32)
    );
    expect(appBound.status).toBe("skipped");
    expect(appBound.status === "skipped" ? appBound.reason : "").toContain("app-bound");
    const wrongKey = decryptChromiumValue(aesEncrypt(randomBytes(32), "x"), randomBytes(32));
    expect(wrongKey.status).toBe("skipped");
    const missingKey = decryptChromiumValue(aesEncrypt(randomBytes(32), "x"), Buffer.alloc(0));
    expect(missingKey.status === "skipped" ? missingKey.reason : "").toContain("encryption key");
  });

  test("rejects empty and truncated ciphertext", () => {
    const key = randomBytes(32);
    expect(decryptChromiumValue("", key).status).toBe("skipped");
    const short = Buffer.concat([Buffer.from("v10"), randomBytes(4)]).toString("base64");
    expect(decryptChromiumValue(short, key).status).toBe("skipped");
  });
});
