import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasPython = Bun.spawnSync(["python3", "--version"]).exitCode === 0;

let homeDir = "";

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

function startServer(
  port: number,
  extraEnv: Record<string, string>,
  args: string[] = []
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      PORT: String(port),
      ...extraEnv,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function stopServer(proc: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!proc) return;
  try {
    proc.kill("SIGTERM");
  } catch {
  }
  await Promise.race([proc.exited, sleep(5000)]);
}

async function waitForServerReady(baseUrl: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function request(
  baseUrl: string,
  path: string,
  headers?: Record<string, string>
): Promise<{
  status: number;
  data: unknown;
  headers: Headers;
}> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data, headers: response.headers };
}

async function readFirstSseChunk(
  url: string,
  headers?: Record<string, string>
): Promise<{ status: number; headers: Headers; chunk: string }> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers,
    signal: controller.signal,
  });

  if (!response.body || response.status !== 200) {
    return { status: response.status, headers: response.headers, chunk: "" };
  }

  const reader = response.body.getReader();
  const { value } = await reader.read();
  const chunk = value ? new TextDecoder().decode(value) : "";
  controller.abort();
  return { status: response.status, headers: response.headers, chunk };
}

async function openWebSocket(url: string, timeoutMs = 15000): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket failed before open"));
    };
  });
  return ws;
}

async function expectWebSocketOpenFailure(url: string, timeoutMs = 10000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // no-op
      }
      resolve();
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // no-op
      }
      reject(new Error("WebSocket unexpectedly opened"));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function extractErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }
  return "";
}

describe("Security auth e2e", () => {
  beforeAll(() => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-auth-e2e-home-"));
  });

  afterAll(() => {
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("production mode enforces API key on protected endpoints", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(port, {
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      const health = await request(baseUrl, "/api/health");
      expect(health.status).toBe(200);
      expect(health.data.status).toBe("healthy");

      const missingAuth = await request(baseUrl, "/api/info");
      expect(missingAuth.status).toBe(401);
      expect(missingAuth.data.error).toContain("Missing Authorization");
      expect(missingAuth.headers.get("www-authenticate")).toContain("Bearer");

      const wrongAuth = await request(baseUrl, "/api/info", {
        Authorization: "Bearer wrong-key",
      });
      expect(wrongAuth.status).toBe(401);
      expect(wrongAuth.data.error).toContain("Invalid API key");

      const bearerAuth = await request(baseUrl, "/api/info", {
        Authorization: `Bearer ${apiKey}`,
      });
      expect(bearerAuth.status).toBe(200);
      expect(bearerAuth.data.name).toBe("Cybara");
      expect(bearerAuth.headers.get("x-ratelimit-remaining")).not.toBeNull();

      const rawTokenAuth = await request(baseUrl, "/api/info", {
        Authorization: apiKey,
      });
      expect(rawTokenAuth.status).toBe(200);
      expect(rawTokenAuth.data.name).toBe("Cybara");
    } finally {
      await stopServer(proc);
    }
  });

  test("development mode allows localhost bypass even when API key is configured", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(port, {
        NODE_ENV: "development",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      const info = await request(baseUrl, "/api/info");
      expect(info.status).toBe(200);
      expect(info.data.name).toBe("Cybara");
    } finally {
      await stopServer(proc);
    }
  });

  test("production mode enforces tighter chat and oauth rate-limit windows", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(port, {
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      let chatLimited: { status: number; data: unknown; headers: Headers } | null = null;
      for (let i = 0; i < 80; i++) {
        const res = await request(baseUrl, "/api/chat/sessions", {
          Authorization: `Bearer ${apiKey}`,
        });
        if (res.status === 429) {
          chatLimited = res;
          break;
        }
        expect(res.status).toBe(200);
      }

      expect(chatLimited).toBeDefined();
      expect(extractErrorMessage(chatLimited?.data)).toContain("Rate limit exceeded");
      expect(chatLimited?.headers.get("retry-after")).not.toBeNull();
      expect(chatLimited?.headers.get("x-ratelimit-remaining")).toBe("0");

      let oauthLimited: { status: number; data: unknown; headers: Headers } | null = null;
      for (let i = 0; i < 15; i++) {
        const res = await fetch(`${baseUrl}/api/providers/oauth/start`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ providerType: `missing-provider-${Date.now()}-${i}` }),
        });
        const data = await res.json();
        const wrapped = { status: res.status, data, headers: res.headers };
        if (wrapped.status === 429) {
          oauthLimited = wrapped;
          break;
        }
        expect(wrapped.status).toBe(400);
      }

      expect(oauthLimited).toBeDefined();
      expect(extractErrorMessage(oauthLimited?.data)).toContain("Rate limit exceeded");
      expect(oauthLimited?.headers.get("retry-after")).not.toBeNull();
      expect(oauthLimited?.headers.get("x-ratelimit-remaining")).toBe("0");

      let pairingLimited: { status: number; data: unknown; headers: Headers } | null = null;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/channels/test-channel/pairings/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code: `invalid-${i}` }),
        });
        const data = await res.json();
        const wrapped = { status: res.status, data, headers: res.headers };
        if (wrapped.status === 429) {
          pairingLimited = wrapped;
          break;
        }
        expect(wrapped.status).toBe(200);
      }

      expect(pairingLimited).toBeDefined();
      expect(extractErrorMessage(pairingLimited?.data)).toContain("Rate limit exceeded");
      expect(pairingLimited?.headers.get("retry-after")).not.toBeNull();
      expect(pairingLimited?.headers.get("x-ratelimit-remaining")).toBe("0");

      const validationError = await fetch(`${baseUrl}/api/open-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "not-a-valid-url" }),
      });
      expect(validationError.status).toBe(400);
      expect(validationError.headers.get("x-ratelimit-remaining")).not.toBeNull();
      expect(validationError.headers.get("x-ratelimit-reset")).not.toBeNull();
    } finally {
      await stopServer(proc);
    }
  });

  test("production mode enforces API key on terminal REST and websocket endpoints", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const baseWsUrl = `ws://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(
        port,
        {
          NODE_ENV: "production",
          CYBARA_API_KEY: apiKey,
        },
        ["--enable-terminal"]
      );
      await waitForServerReady(baseUrl);

      const missingAuth = await request(baseUrl, "/api/terminal/sessions");
      expect(missingAuth.status).toBe(401);
      expect(missingAuth.data.error).toContain("Missing Authorization");
      expect(missingAuth.headers.get("www-authenticate")).toContain("Bearer");

      const wrongAuth = await request(baseUrl, "/api/terminal/sessions", {
        Authorization: "Bearer wrong-key",
      });
      expect(wrongAuth.status).toBe(401);
      expect(wrongAuth.data.error).toContain("Invalid API key");

      const okAuth = await request(baseUrl, "/api/terminal/sessions", {
        Authorization: `Bearer ${apiKey}`,
      });
      expect(okAuth.status).toBe(200);
      expect(Array.isArray(okAuth.data)).toBe(true);
      expect(okAuth.headers.get("x-ratelimit-remaining")).not.toBeNull();

      await expectWebSocketOpenFailure(
        `${baseWsUrl}/api/terminal/ws?session=${encodeURIComponent(`unauth-${Date.now()}`)}`
      );

      if (hasPython) {
        const ws = await openWebSocket(
          `${baseWsUrl}/api/terminal/ws?session=${encodeURIComponent(`auth-${Date.now()}`)}&token=${encodeURIComponent(apiKey)}`
        );
        ws.close();

        const wsWithApiKeyParam = await openWebSocket(
          `${baseWsUrl}/api/terminal/ws?session=${encodeURIComponent(`auth-api-key-${Date.now()}`)}&api_key=${encodeURIComponent(apiKey)}`
        );
        wsWithApiKeyParam.close();
      }
    } finally {
      await stopServer(proc);
    }
  });

  test("production mode enforces API key on status SSE endpoint and allows token/api_key query auth", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(port, {
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      const missingAuth = await request(baseUrl, "/api/sse/status");
      expect(missingAuth.status).toBe(401);
      expect(missingAuth.data.error).toContain("Missing Authorization");
      expect(missingAuth.headers.get("www-authenticate")).toContain("Bearer");

      const sse = await readFirstSseChunk(
        `${baseUrl}/api/sse/status?token=${encodeURIComponent(apiKey)}`
      );
      expect(sse.status).toBe(200);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      expect(sse.chunk).toContain("data:");
      expect(sse.headers.get("x-ratelimit-remaining")).not.toBeNull();

      const sseApiKeyParam = await readFirstSseChunk(
        `${baseUrl}/api/sse/status?api_key=${encodeURIComponent(apiKey)}`
      );
      expect(sseApiKeyParam.status).toBe(200);
      expect(sseApiKeyParam.headers.get("content-type")).toContain("text/event-stream");
      expect(sseApiKeyParam.chunk).toContain("data:");
      expect(sseApiKeyParam.headers.get("x-ratelimit-remaining")).not.toBeNull();
    } finally {
      await stopServer(proc);
    }
  });

  test("production mode enforces API key on IDE routes and keeps HOME sandbox restrictions", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const insideFile = join(homeDir, `ide-auth-inside-${Date.now()}.txt`);
    const outsideDir = `${homeDir}-ide-outside-${Date.now()}`;
    const outsideFile = join(outsideDir, "outside.txt");
    const symlinkDir = join(homeDir, `ide-auth-link-${Date.now()}`);
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let symlinkCreated = false;

    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(insideFile, "inside-home-file", "utf8");
    writeFileSync(outsideFile, "outside-home-file", "utf8");
    try {
      symlinkSync(outsideDir, symlinkDir);
      symlinkCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
    }

    try {
      proc = startServer(port, {
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      const missingAuth = await request(
        baseUrl,
        `/api/ide/read?path=${encodeURIComponent(insideFile)}`
      );
      expect(missingAuth.status).toBe(401);
      expect(missingAuth.data.error).toContain("Missing Authorization");

      const browseHome = await request(baseUrl, `/api/ide/browse?path=${encodeURIComponent(homeDir)}`, {
        Authorization: `Bearer ${apiKey}`,
      });
      expect(browseHome.status).toBe(200);
      expect(browseHome.data.success).toBe(true);

      const readInside = await request(
        baseUrl,
        `/api/ide/read?path=${encodeURIComponent(insideFile)}`,
        {
          Authorization: `Bearer ${apiKey}`,
        }
      );
      expect(readInside.status).toBe(200);
      expect(readInside.data.success).toBe(true);
      expect(readInside.data.content).toContain("inside-home-file");

      const browseOutside = await request(
        baseUrl,
        `/api/ide/browse?path=${encodeURIComponent(outsideDir)}`,
        {
          Authorization: `Bearer ${apiKey}`,
        }
      );
      expect(browseOutside.status).toBe(200);
      expect(browseOutside.data.success).toBe(false);
      expect(String(browseOutside.data.error || "")).toContain("Access denied");

      const readOutside = await request(
        baseUrl,
        `/api/ide/read?path=${encodeURIComponent(outsideFile)}`,
        {
          Authorization: `Bearer ${apiKey}`,
        }
      );
      expect(readOutside.status).toBe(200);
      expect(readOutside.data.success).toBe(false);
      expect(String(readOutside.data.error || "")).toContain("Access denied");

      const writeOutsideRes = await fetch(`${baseUrl}/api/ide/write`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: outsideFile,
          content: "should-not-write",
        }),
      });
      const writeOutside = (await writeOutsideRes.json()) as { success?: boolean; error?: string };
      expect(writeOutsideRes.status).toBe(200);
      expect(writeOutside.success).toBe(false);
      expect(String(writeOutside.error || "")).toContain("Access denied");

      if (symlinkCreated) {
        const readViaSymlink = await request(
          baseUrl,
          `/api/ide/read?path=${encodeURIComponent(join(symlinkDir, "outside.txt"))}`,
          {
            Authorization: `Bearer ${apiKey}`,
          }
        );
        expect(readViaSymlink.status).toBe(200);
        expect(readViaSymlink.data.success).toBe(false);
        expect(String(readViaSymlink.data.error || "")).toContain("Access denied");
      }
    } finally {
      await stopServer(proc);
      rmSync(insideFile, { force: true });
      rmSync(symlinkDir, { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("production mode enforces API key on git routes", async () => {
    const apiKey = `cybara_e2e_key_${Date.now()}`;
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    try {
      proc = startServer(port, {
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
      });
      await waitForServerReady(baseUrl);

      const missingStatus = await request(
        baseUrl,
        `/api/git/status?path=${encodeURIComponent(ROOT_DIR)}`
      );
      expect(missingStatus.status).toBe(401);
      expect(missingStatus.data.error).toContain("Missing Authorization");

      const authStatus = await request(
        baseUrl,
        `/api/git/status?path=${encodeURIComponent(ROOT_DIR)}`,
        {
          Authorization: `Bearer ${apiKey}`,
        }
      );
      expect(authStatus.status).toBe(200);
      expect(typeof authStatus.data.isRepo).toBe("boolean");
      expect(Array.isArray(authStatus.data.staged)).toBe(true);
      expect(Array.isArray(authStatus.data.modified)).toBe(true);
      expect(Array.isArray(authStatus.data.untracked)).toBe(true);
      expect(authStatus.headers.get("x-ratelimit-remaining")).not.toBeNull();

      const authBranch = await request(
        baseUrl,
        `/api/git/branch?path=${encodeURIComponent(ROOT_DIR)}`,
        {
          Authorization: `Bearer ${apiKey}`,
        }
      );
      expect(authBranch.status).toBe(200);
      expect("branch" in authBranch.data).toBe(true);
      expect(authBranch.headers.get("x-ratelimit-remaining")).not.toBeNull();

      const diffMissingPath = await request(baseUrl, "/api/git/diff", {
        Authorization: `Bearer ${apiKey}`,
      });
      expect(diffMissingPath.status).toBe(200);
      expect(diffMissingPath.data.success).toBe(false);
      expect(String(diffMissingPath.data.error || "")).toContain("Missing 'path' parameter");
      expect(diffMissingPath.headers.get("x-ratelimit-remaining")).not.toBeNull();
    } finally {
      await stopServer(proc);
    }
  });
});
