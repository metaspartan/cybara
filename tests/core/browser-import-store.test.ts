import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserImportData } from "../../shared/browser-import";
import { BrowserImportStore } from "../../src/core/browser/import-store";

const roots: string[] = [];
function store(): { storage: BrowserImportStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "cybara-import-store-"));
  roots.push(root);
  return { root, storage: new BrowserImportStore(root) };
}
function data(): BrowserImportData {
  return {
    passwords: [
      {
        id: "login-1",
        origin: "https://example.test",
        username: "alice",
        password: "private-password-123",
      },
    ],
    cookies: [
      {
        name: "session",
        value: "private-cookie-456",
        domain: "example.test",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    history: [{ url: "https://example.test/path", title: "Example", visited_at: 100 }],
    bookmarks: [{ url: "https://example.test", title: "Home" }],
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("encrypted browser import store", () => {
  test("round trips every category while excluding secrets from public library", () => {
    const { root, storage } = store();
    expect(storage.counts()).toEqual({ passwords: 0, cookies: 0, history: 0, bookmarks: 0 });
    expect(storage.import(data())).toEqual({ passwords: 1, cookies: 1, history: 1, bookmarks: 1 });
    const fresh = new BrowserImportStore(root);
    expect(fresh.login("login-1")?.password).toBe("private-password-123");
    expect(fresh.cookies()[0]?.value).toBe("private-cookie-456");
    const publicData = JSON.stringify(fresh.library());
    expect(publicData).not.toContain("private-password");
    expect(publicData).not.toContain("private-cookie");
    expect(publicData).not.toContain('"password":');
    expect(fresh.library().logins).toEqual([
      { id: "login-1", origin: "https://example.test", username: "alice" },
    ]);
    const disk = readFileSync(join(root, "browser", "imported", "data.enc"), "utf8");
    expect(disk).toStartWith("cybara-secret:v1:");
    expect(disk).not.toContain("alice");
    expect(disk).not.toContain("example.test");
    expect(disk).not.toContain("private-password");
    expect(disk).not.toContain("private-cookie");
  });

  test("rejects plaintext replacements and tampered encrypted files", () => {
    const { root, storage } = store();
    storage.import(data());
    const file = join(root, "browser", "imported", "data.enc");
    writeFileSync(file, JSON.stringify({ version: 1, data: data() }));
    expect(() => storage.library()).toThrow("must be encrypted");
    writeFileSync(file, "cybara-secret:v1:not-an-authenticated-envelope");
    expect(() => storage.library()).toThrow();
  });
  test("reimports update matching records without duplicating them", () => {
    const { storage } = store();
    storage.import(data());
    const updated = data();
    const login = updated.passwords[0];
    if (!login) throw new Error("Missing fixture");
    login.password = "updated";
    storage.import(updated);
    expect(storage.counts()).toEqual({ passwords: 1, cookies: 1, history: 1, bookmarks: 1 });
    expect(storage.login("login-1")?.password).toBe("updated");
  });

  test("expired cookies are never reapplied", () => {
    const { storage } = store();
    const fixture = data();
    const cookie = fixture.cookies[0];
    if (!cookie) throw new Error("Missing fixture");
    cookie.expires = 1;
    storage.import(fixture);
    expect(storage.cookies()).toEqual([]);
  });
});
