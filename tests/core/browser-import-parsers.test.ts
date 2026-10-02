import { describe, expect, test } from "bun:test";
import {
  BROWSER_IMPORT_MAX_BYTES,
  parseBrowserImportFile,
} from "../../src/core/browser/import-parsers";

describe("browser import file parsing", () => {
  test("password CSV preserves quoted commas, quotes and multiline content", () => {
    const parsed = parseBrowserImportFile(
      "passwords",
      '\uFEFFname,url,username,password\r\nExample,https://example.test/login,"alice,bob","line1\nline2""quoted"""\r\n'
    );
    expect(parsed.passwords[0]).toMatchObject({
      origin: "https://example.test",
      username: "alice,bob",
      password: 'line1\nline2"quoted"',
    });
    expect(parsed.passwords[0]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.cookies).toEqual([]);
  });

  test("password CSV rejects non-web and embedded-credential URLs, broken quotes and missing columns", () => {
    for (const text of [
      "url,username,password\nfile:///secret,alice,private",
      "url,username,password\nhttps://alice:secret@example.test,alice,private",
      'url,username,password\nhttps://example.test,alice,"unclosed',
      "username,password\nalice,private",
      "url,username,password\nhttps://example.test,alice,private,extra",
      "url,username,password\nhttps://example.test,alice,",
    ])
      expect(() => parseBrowserImportFile("passwords", text)).toThrow();
  });

  test("JSON and Netscape cookies preserve flags, session lifetime and HttpOnly", () => {
    const json = parseBrowserImportFile(
      "cookies",
      JSON.stringify({
        cookies: [
          {
            domain: ".example.test",
            name: "session",
            value: "private",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "no_restriction",
            expirationDate: Date.now() / 1000 + 3600,
          },
        ],
      })
    );
    expect(json.cookies[0]).toMatchObject({
      sameSite: "None",
      secure: true,
      httpOnly: true,
      value: "private",
    });
    const netscape = parseBrowserImportFile(
      "cookies",
      "# Netscape HTTP Cookie File\n#HttpOnly_example.test\tFALSE\t/\tTRUE\t0\tsession\tsecret\n"
    );
    expect(netscape.cookies[0]).toMatchObject({
      domain: "example.test",
      expires: -1,
      httpOnly: true,
      secure: true,
    });
    const expired = parseBrowserImportFile(
      "cookies",
      '[{"domain":"example.test","name":"old","value":"secret","expires":1}]'
    );
    expect(expired.cookies).toEqual([]);
  });

  test("rejects unsafe cookie names, values and security flags", () => {
    for (const extra of [
      { name: "bad name" },
      { value: "bad\nvalue" },
      { domain: "../../private" },
      { path: "relative" },
      { sameSite: "None", secure: false },
      { expires: "forever" },
      { secure: "true" },
      { name: "__Secure-token", secure: false },
      { name: "__Host-token", secure: true, domain: ".example.test" },
    ]) {
      expect(() =>
        parseBrowserImportFile(
          "cookies",
          JSON.stringify([{ domain: "example.test", name: "token", value: "ok", ...extra }])
        )
      ).toThrow();
    }
  });

  test("bookmarks support HTML entities and Chromium folder trees without running HTML", () => {
    const html = parseBrowserImportFile(
      "bookmarks",
      '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><A HREF="https://example.test/?a=1&amp;b=2">A &amp; B</A></DL>'
    );
    expect(html.bookmarks).toEqual([{ url: "https://example.test/?a=1&b=2", title: "A & B" }]);
    const tree = parseBrowserImportFile(
      "bookmarks",
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            children: [{ type: "url", url: "https://example.test", name: "Home" }],
          },
        },
      })
    );
    expect(tree.bookmarks).toEqual([{ url: "https://example.test/", title: "Home" }]);
    expect(() =>
      parseBrowserImportFile("bookmarks", '<A HREF="javascript:alert(1)">Bad</A>')
    ).toThrow();
  });

  test("history imports epoch-millisecond timestamps and rejects unsafe URLs", () => {
    expect(
      parseBrowserImportFile(
        "history",
        '[{"url":"https://example.test","title":"Home","lastVisitTime":123}]'
      ).history
    ).toEqual([{ url: "https://example.test/", title: "Home", visited_at: 123 }]);
    expect(() =>
      parseBrowserImportFile("history", '[{"url":"file:///secret","visited_at":123}]')
    ).toThrow();
    expect(() =>
      parseBrowserImportFile("history", '[{"url":"https://example.test","visited_at":-1}]')
    ).toThrow();
  });

  test("enforces file byte size below, at and above the boundary", () => {
    for (const size of [BROWSER_IMPORT_MAX_BYTES - 1, BROWSER_IMPORT_MAX_BYTES]) {
      expect(parseBrowserImportFile("history", "[]" + " ".repeat(size - 2)).history).toEqual([]);
    }
    expect(() =>
      parseBrowserImportFile("history", "[]" + " ".repeat(BROWSER_IMPORT_MAX_BYTES - 1))
    ).toThrow("8 MB");
    expect(() =>
      parseBrowserImportFile("history", "é".repeat(BROWSER_IMPORT_MAX_BYTES / 2 + 1))
    ).toThrow("8 MB");
  });

  test("enforces entry count below, at and above the boundary", () => {
    const row = { url: "https://example.test", title: "Home", visited_at: 1 };
    for (const count of [9999, 10000])
      expect(
        parseBrowserImportFile("history", JSON.stringify(Array.from({ length: count }, () => row)))
          .history
      ).toHaveLength(count);
    expect(() =>
      parseBrowserImportFile("history", JSON.stringify(Array.from({ length: 10001 }, () => row)))
    ).toThrow("10,000");
  });
});
