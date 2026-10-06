import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = "browser-import-upload-e2e-key";
let home = "";
let baseUrl = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok || result.error) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result;
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-import-upload-"));
  const allocation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  baseUrl = `http://127.0.0.1:${allocation.port}`;
  allocation.stop(true);
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      CYBARA_HOST: "127.0.0.1",
      PORT: new URL(baseUrl).port,
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("Isolated upload gateway did not start.");
}, 180_000);

afterAll(() => {
  try {
    gateway?.kill("SIGKILL");
  } catch {}
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("uploaded export files import through the real API", () => {
  test("bookmarks, history and cookies uploads persist real counts", async () => {
    const response = await api("/api/browser/import", {
      consent: true,
      categories: ["bookmarks", "history", "cookies"],
      files: {
        bookmarks: JSON.stringify({
          roots: {
            bookmark_bar: {
              children: [
                { type: "url", name: "Alpha", url: "https://alpha.test/" },
                { type: "url", name: "Beta", url: "https://beta.test/" },
              ],
            },
          },
        }),
        history: JSON.stringify([
          { url: "https://alpha.test/one", title: "One", visited_at: 1_700_000_000_000 },
          { url: "https://beta.test/two", title: "Two", visited_at: 1_700_000_001_000 },
          { url: "https://alpha.test/three", title: "Three", visited_at: 1_700_000_002_000 },
        ]),
        cookies: JSON.stringify([
          {
            name: "session",
            value: "uploaded-cookie-value",
            domain: ".alpha.test",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ]),
      },
    });

    const imported = response.imported as Record<string, number>;
    expect(imported.bookmarks).toBe(2);
    expect(imported.history).toBe(3);
    expect(imported.cookies).toBe(1);

    const library = await api("/api/browser/import/library");
    const bookmarks = library.bookmarks as Array<{ url: string; title: string }>;
    const history = library.history as Array<{ url: string }>;
    expect(bookmarks.map((entry) => entry.url).sort()).toEqual([
      "https://alpha.test/",
      "https://beta.test/",
    ]);
    expect(history.map((entry) => entry.url)).toContain("https://alpha.test/three");
  }, 120_000);

  test("a malformed upload is rejected instead of reporting a false success", async () => {
    await expect(
      api("/api/browser/import", {
        consent: true,
        categories: ["bookmarks"],
        files: { bookmarks: "{not json" },
      })
    ).rejects.toThrow();
  }, 60_000);

  test("uploads without consent are refused", async () => {
    await expect(
      api("/api/browser/import", {
        categories: ["bookmarks"],
        files: { bookmarks: "[]" },
      })
    ).rejects.toThrow();
  }, 60_000);
});
