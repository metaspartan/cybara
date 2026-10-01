import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = "browser-import-smoke-fixture";
let processHandle: ReturnType<typeof Bun.spawn> | undefined;
let home = "";
let url = "";

async function api(
  path: string,
  body?: unknown,
  authenticated = true
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-browser-import-e2e-"));
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = listener.port;
  listener.stop(true);
  url = `http://127.0.0.1:${port}`;
  processHandle = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      PORT: String(port),
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("Browser import test gateway did not start.");
}, 40_000);

afterAll(async () => {
  if (processHandle) {
    processHandle.kill();
    await processHandle.exited;
  }
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("authenticated browser import HTTP workflow", () => {
  test("rejects unauthorized and missing-consent requests, then persists and exposes only safe library fields", async () => {
    expect((await api("/api/browser/import/library", undefined, false)).status).toBe(401);
    const before = await api("/api/browser/import/sources");
    expect(before.status).toBe(200);
    expect(before.data.counts).toEqual({ passwords: 0, cookies: 0, history: 0, bookmarks: 0 });
    const files = {
      passwords: "url,username,password\nhttps://example.test/login,alice,private-fixture-secret\n",
      history:
        '[{"url":"https://example.test/history","title":"Fixture history","visited_at":123}]',
      bookmarks: '[{"url":"https://example.test/bookmark","title":"Fixture bookmark"}]',
    };
    const rejected = await api("/api/browser/import", {
      categories: ["passwords", "history", "bookmarks"],
      files,
    });
    expect(rejected.data.success).toBe(false);
    const imported = await api("/api/browser/import", {
      consent: true,
      categories: ["passwords", "history", "bookmarks"],
      files,
    });
    expect(imported.data.success).toBe(true);
    expect(imported.data.imported).toEqual({ passwords: 1, cookies: 0, history: 1, bookmarks: 1 });
    const library = await api("/api/browser/import/library");
    expect(library.data.history).toEqual([
      { url: "https://example.test/history", title: "Fixture history", visited_at: 123 },
    ]);
    expect(library.data.bookmarks).toEqual([
      { url: "https://example.test/bookmark", title: "Fixture bookmark" },
    ]);
    expect(JSON.stringify(library.data)).not.toContain("private-fixture-secret");
    expect(JSON.stringify(library.data)).not.toContain('"password":');
    const again = await api("/api/browser/import", {
      consent: true,
      categories: ["passwords", "history", "bookmarks"],
      files,
    });
    expect(again.data.success).toBe(true);
    expect((await api("/api/browser/import/sources")).data.counts).toEqual({
      passwords: 1,
      cookies: 0,
      history: 1,
      bookmarks: 1,
    });
    const malformed = await api("/api/browser/import", {
      consent: true,
      categories: ["history"],
      files: { history: '{"private-fixture-secret":' },
    });
    expect(malformed.data.success).toBe(false);
    expect(JSON.stringify(malformed.data)).not.toContain("private-fixture-secret");
  });
});
