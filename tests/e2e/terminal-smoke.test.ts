import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let baseUrl = "";
let baseWsUrl = "";
let homeDir = "";
let apiKey = "";

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

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 15000,
  intervalMs = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

function toText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString("utf8");
  return String(data);
}

describe("Terminal e2e smoke", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-term-e2e-home-"));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    baseWsUrl = `ws://127.0.0.1:${port}`;
    apiKey = `cybara_terminal_e2e_${Date.now()}_root_key`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts", "--enable-terminal"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        CYBARA_API_KEY: apiKey,
        HOME: homeDir,
        USERPROFILE: homeDir,
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(baseUrl);
  });

  afterAll(async () => {
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5000)]);
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("terminal session endpoint is enabled", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/sessions`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ id: string }>;
    expect(Array.isArray(data)).toBe(true);
  });

  test("websocket supports editing, history, interrupts, resize, and cleanup", async () => {
    const sessionId = `term-e2e-${Date.now()}`;
    const editMarker = `CYBARA_TERM_EDIT_${Date.now()}`;
    const interruptMarker = `CYBARA_TERM_INTERRUPT_${Date.now()}`;
    let ws: WebSocket | null = null;
    let output = "";

    try {
      ws = new WebSocket(
        `${baseWsUrl}/api/terminal/ws?session=${encodeURIComponent(sessionId)}&api_key=${encodeURIComponent(apiKey)}`
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 15000);
        ws!.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws!.onerror = () => {
          clearTimeout(timer);
          reject(new Error("WebSocket error before open"));
        };
      });

      ws.onmessage = (event) => {
        output += toText(event.data);
      };

      ws.send(`${String.fromCharCode(27)}[RESIZE:96,28]`);
      ws.send(`echo ${editMarker}_BAD`);
      ws.send(String.fromCharCode(127).repeat(3));
      ws.send("OK\r");

      await waitFor(() => output.includes(`${editMarker}_OK`), 20000, 100);

      output = "";
      ws.send(`${String.fromCharCode(27)}[A\r`);
      await waitFor(() => output.includes(`${editMarker}_OK`), 20000, 100);

      output = "";
      ws.send(process.platform === "win32" ? "ping -n 30 127.0.0.1 >NUL\r" : "sleep 30\r");
      await sleep(300);
      ws.send(String.fromCharCode(3));
      ws.send(`echo ${interruptMarker}\r`);
      await waitFor(() => output.includes(interruptMarker), 20000, 100);

      const sessionsRes = await fetch(`${baseUrl}/api/terminal/sessions`, {
        headers: authHeaders(),
      });
      expect(sessionsRes.status).toBe(200);
      const sessions = (await sessionsRes.json()) as Array<{ id: string }>;
      expect(sessions.some((s) => s.id === sessionId)).toBe(true);
    } finally {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }

    await waitFor(async () => {
      const sessionsRes = await fetch(`${baseUrl}/api/terminal/sessions`, {
        headers: authHeaders(),
      });
      if (!sessionsRes.ok) return false;
      const sessions = (await sessionsRes.json()) as Array<{ id: string }>;
      return !sessions.some((s) => s.id === sessionId);
    });
  });
});
