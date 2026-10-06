import { describe, expect, test } from "bun:test";
import { parseBrowserImportFile } from "../../src/core/browser/import-parsers";

describe("uploaded export files are parsed, not silently dropped", () => {
  test("a bookmarks export round-trips through the shared parser", () => {
    const uploaded = JSON.stringify({
      roots: {
        bookmark_bar: {
          children: [{ type: "url", name: "Home", url: "https://example.test/" }],
        },
      },
    });
    expect(parseBrowserImportFile("bookmarks", uploaded).bookmarks).toEqual([
      { url: "https://example.test/", title: "Home" },
    ]);
  });

  test("a history export round-trips through the shared parser", () => {
    const uploaded = JSON.stringify([
      { url: "https://example.test/page", title: "Page", visited_at: 1_700_000_000_000 },
    ]);
    expect(parseBrowserImportFile("history", uploaded).history).toEqual([
      { url: "https://example.test/page", title: "Page", visited_at: 1_700_000_000_000 },
    ]);
  });

  test("a cookies export round-trips through the shared parser", () => {
    const uploaded = JSON.stringify([
      {
        name: "session",
        value: "abc",
        domain: ".example.test",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    expect(parseBrowserImportFile("cookies", uploaded).cookies).toEqual([
      {
        name: "session",
        value: "abc",
        domain: ".example.test",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("a passwords export round-trips through the shared parser", () => {
    const uploaded = "url,username,password\nhttps://example.test,alice,secret\n";
    const passwords = parseBrowserImportFile("passwords", uploaded).passwords;
    expect(passwords).toHaveLength(1);
    expect(passwords[0]?.username).toBe("alice");
    expect(passwords[0]?.password).toBe("secret");
  });
});
