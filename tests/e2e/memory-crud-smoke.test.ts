import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let homeDir = "";
let baseUrl = "";
let apiKey = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function startServer(port: number): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      PORT: String(port),
      NODE_ENV: "production",
      CYBARA_API_KEY: apiKey,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function stopServer(target: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!target) return;
  try {
    target.kill("SIGTERM");
  } catch {}
  await Promise.race([target.exited, sleep(5000)]);
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? ((await response.json()) as Record<string, unknown>)
    : { text: await response.text() };
  return { status: response.status, data };
}

describe("memory CRUD e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-memory-e2e-home-"));
    apiKey = `cybara_e2e_memory_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
    await api("POST", "/api/setup/complete");
  });

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("creates, searches, edits, appends, and deletes memory over authenticated HTTP", async () => {
    const rawFile = `memory e2e ${Date.now()}.md`;
    const expectedFile = rawFile.replace(/[^\w.-]/g, "-");
    const encodedRawFile = encodeURIComponent(rawFile);
    const firstNeedle = `first-${Date.now()}`;
    const secondNeedle = `second-${Date.now()}`;

    const create = await api("POST", "/api/memory", {
      file: rawFile,
      content: `first memory entry ${firstNeedle}`,
    });
    expect(create.status).toBe(200);
    expect(create.data.success).toBe(true);
    expect(create.data.file).toBe(expectedFile);
    expect(create.data.appended).toBe(false);

    const list = await api("GET", "/api/memory");
    expect(list.status).toBe(200);
    expect(list.data.files as string[]).toContain(expectedFile);

    const edit = await api("PUT", `/api/memory/${encodedRawFile}`, {
      index: 0,
      content: `edited memory entry ${firstNeedle}`,
    });
    expect(edit.status).toBe(200);
    expect(edit.data.success).toBe(true);

    const append = await api("POST", "/api/memory", {
      file: rawFile,
      content: `second memory entry ${secondNeedle}`,
    });
    expect(append.status).toBe(200);
    expect(append.data.appended).toBe(true);

    const search = await api("GET", `/api/memory/search?query=${encodeURIComponent(secondNeedle)}`);
    expect(search.status).toBe(200);
    const results = search.data.results as Array<{
      file: string;
      entry: { index: number; content: string };
    }>;
    const hit = results.find((result) => result.file === expectedFile);
    expect(hit?.entry.index).toBe(1);
    expect(hit?.entry.content).toContain(secondNeedle);

    const deleteEntry = await api("DELETE", `/api/memory/${encodedRawFile}`, { index: 0 });
    expect(deleteEntry.status).toBe(200);
    expect(deleteEntry.data.success).toBe(true);

    const afterEntryDelete = await api("GET", "/api/memory");
    const memory = (
      afterEntryDelete.data.memories as Array<{ file: string; entries: unknown[] }>
    ).find((item) => item.file === expectedFile);
    expect(memory?.entries).toHaveLength(1);

    const deleteFile = await api("DELETE", `/api/memory/${encodedRawFile}`);
    expect(deleteFile.status).toBe(200);
    expect(deleteFile.data.success).toBe(true);

    const afterFileDelete = await api("GET", "/api/memory");
    expect(afterFileDelete.data.files as string[]).not.toContain(expectedFile);
  });
});
