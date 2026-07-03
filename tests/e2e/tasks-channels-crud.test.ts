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
  options: { body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : { text: await response.text() };
  return { status: response.status, data };
}

interface TaskShape {
  id: string;
  name: string;
  schedule?: string;
  status: string;
  next_run?: string | null;
  config: Record<string, unknown>;
}

interface ChannelShape {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: number | boolean;
}

describe("tasks and channels CRUD e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-crud-e2e-home-"));
    apiKey = `cybara_e2e_crud_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("cron task lifecycle preserves schedule fields across status updates", async () => {
    const created = await api("POST", "/api/tasks", {
      body: {
        name: "crud e2e cron task",
        description: "cron crud contract",
        action: "noop",
        schedule: "0 * * * *",
        enabled: false,
      },
    });
    expect(created.status).toBe(200);
    const task = created.data as TaskShape;
    expect(typeof task.id).toBe("string");
    expect(task.status).toBe("paused");
    expect(task.schedule).toBe("0 * * * *");

    const list = await api("GET", "/api/tasks");
    expect(list.status).toBe(200);
    const tasks = list.data as TaskShape[];
    expect(tasks.some((t) => t.id === task.id)).toBe(true);

    const started = await api("POST", `/api/tasks/${task.id}/start`);
    expect(started.status).toBe(200);
    expect((started.data as { success: boolean }).success).toBe(true);

    const afterStart = await api("GET", `/api/tasks/${task.id}`);
    expect(afterStart.status).toBe(200);
    const startedTask = afterStart.data as TaskShape;
    expect(startedTask.status).toBe("pending");
    expect(startedTask.name).toBe("crud e2e cron task");
    expect(startedTask.schedule).toBe("0 * * * *");
    expect(startedTask.config.action).toBe("noop");
    expect(startedTask.config.description).toBe("cron crud contract");
    expect(typeof startedTask.next_run).toBe("string");

    const stopped = await api("POST", `/api/tasks/${task.id}/stop`);
    expect((stopped.data as { success: boolean }).success).toBe(true);
    const afterStop = await api("GET", `/api/tasks/${task.id}`);
    const stoppedTask = afterStop.data as TaskShape;
    expect(stoppedTask.status).toBe("paused");
    expect(stoppedTask.schedule).toBe("0 * * * *");
    expect(stoppedTask.next_run).toBeNull();

    const updated = await api("PUT", `/api/tasks/${task.id}`, {
      body: {
        name: "crud e2e cron task updated",
        description: "updated cron crud contract",
        action: "updated noop",
        schedule: "*/15 * * * *",
        enabled: true,
      },
    });
    expect(updated.status).toBe(200);
    const updatedTask = updated.data as TaskShape & { enabled?: boolean };
    expect(updatedTask.name).toBe("crud e2e cron task updated");
    expect(updatedTask.status).toBe("pending");
    expect(updatedTask.enabled).toBe(true);
    expect(updatedTask.schedule).toBe("*/15 * * * *");
    expect(updatedTask.config.action).toBe("updated noop");
    expect(updatedTask.config.description).toBe("updated cron crud contract");
    expect(typeof updatedTask.next_run).toBe("string");

    const partiallyUpdated = await api("PUT", `/api/tasks/${task.id}`, {
      body: { description: "partial cron crud contract" },
    });
    expect(partiallyUpdated.status).toBe(200);
    const partiallyUpdatedTask = partiallyUpdated.data as TaskShape & { enabled?: boolean };
    expect(partiallyUpdatedTask.status).toBe("pending");
    expect(partiallyUpdatedTask.enabled).toBe(true);
    expect(partiallyUpdatedTask.name).toBe("crud e2e cron task updated");
    expect(partiallyUpdatedTask.schedule).toBe("*/15 * * * *");
    expect(partiallyUpdatedTask.config.action).toBe("updated noop");
    expect(partiallyUpdatedTask.config.description).toBe("partial cron crud contract");

    const deleted = await api("DELETE", `/api/tasks/${task.id}`);
    expect(deleted.status).toBe(200);
    expect((deleted.data as { success: boolean }).success).toBe(true);

    const missing = await api("GET", `/api/tasks/${task.id}`);
    expect(missing.status).toBe(200);
    expect((missing.data as Record<string, unknown>).error).toBe("Task not found");
  }, 25000);

  test("invalid cron schedule is rejected with a validation error", async () => {
    const created = await api("POST", "/api/tasks", {
      body: { name: "crud e2e bad cron", schedule: "not a cron", enabled: false },
    });
    expect(created.status).toBe(400);
    const body = created.data as Record<string, unknown>;
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(String(body.error)).toContain("Invalid cron schedule");

    const list = await api("GET", "/api/tasks");
    const tasks = (Array.isArray(list.data) ? list.data : []) as Array<{ name?: string }>;
    expect(tasks.some((t) => t.name === "crud e2e bad cron")).toBe(false);
  }, 15000);

  test("task without a name is rejected with a validation error", async () => {
    const created = await api("POST", "/api/tasks", {
      body: { schedule: "*/5 * * * *", enabled: false },
    });
    expect(created.status).toBe(400);
    const body = created.data as Record<string, unknown>;
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(String(body.error)).toContain("Task name is required");
  }, 15000);

  test("webhook channel CRUD: rename-only update preserves config and enabled (COALESCE)", async () => {
    const created = await api("POST", "/api/channels", {
      body: {
        type: "webhook",
        name: "crud e2e hook",
        config: { secret: "e2e-shared-secret" },
      },
    });
    expect(created.status).toBe(200);
    const channel = created.data as ChannelShape;
    expect(typeof channel.id).toBe("string");
    expect(channel.type).toBe("webhook");
    expect(Boolean(channel.enabled)).toBe(true);

    const list = await api("GET", "/api/channels");
    expect(list.status).toBe(200);
    const channels = list.data as ChannelShape[];
    expect(channels.some((c) => c.id === channel.id)).toBe(true);

    const renamed = await api("PUT", `/api/channels/${channel.id}`, {
      body: { name: "crud e2e hook renamed" },
    });
    expect(renamed.status).toBe(200);
    expect((renamed.data as { success: boolean }).success).toBe(true);

    const afterRename = await api("GET", `/api/channels/${channel.id}`);
    expect(afterRename.status).toBe(200);
    const renamedChannel = afterRename.data as ChannelShape;
    expect(renamedChannel.name).toBe("crud e2e hook renamed");
    expect(Boolean(renamedChannel.enabled)).toBe(true);
    expect(typeof renamedChannel.config.secret).toBe("string");
    expect(String(renamedChannel.config.secret).length).toBeGreaterThan(0);

    const disabled = await api("POST", `/api/channels/${channel.id}/toggle`, {
      body: { enabled: false },
    });
    expect((disabled.data as { success: boolean }).success).toBe(true);

    const afterDisable = await api("GET", `/api/channels/${channel.id}`);
    const disabledChannel = afterDisable.data as ChannelShape;
    expect(Boolean(disabledChannel.enabled)).toBe(false);
    expect(disabledChannel.name).toBe("crud e2e hook renamed");
    expect(typeof disabledChannel.config.secret).toBe("string");

    const deleted = await api("DELETE", `/api/channels/${channel.id}`);
    expect(deleted.status).toBe(200);
    expect((deleted.data as { success: boolean }).success).toBe(true);

    const afterDelete = await api("GET", "/api/channels");
    const remaining = afterDelete.data as ChannelShape[];
    expect(remaining.some((c) => c.id === channel.id)).toBe(false);
  }, 25000);

  test("channel creation without type or name returns a 400 validation error", async () => {
    const missingName = await api("POST", "/api/channels", { body: { type: "webhook" } });
    expect(missingName.status).toBe(400);
    expect((missingName.data as Record<string, unknown>).code).toBe("VALIDATION_ERROR");

    const missingType = await api("POST", "/api/channels", { body: { name: "no type e2e" } });
    expect(missingType.status).toBe(400);
    expect((missingType.data as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
  }, 15000);
});
