import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface MediaWorkerReport {
  blockedError: string;
  fetchCallsAfterBlocked: number;
  saved: { bytes: number; contentType?: string; path: string };
  fetched: Array<{ url: string; auth?: string | null }>;
  savedUnderCybaraHome: boolean;
}

const WORKER_SOURCE = `
import { saveInboundMediaFromUrl } from "${join(ROOT_DIR, "src", "core", "channels", "media.ts").replace(/\\/g, "/")}";
import { cybaraDir } from "${join(ROOT_DIR, "src", "core", "paths.ts").replace(/\\/g, "/")}";

const fetched = [];
globalThis.fetch = (async (url, init) => {
  const headers = new Headers(init?.headers);
  fetched.push({ url: String(url), auth: headers.get("authorization") });
  return new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}) as typeof fetch;

let blockedError = "";
try {
  await saveInboundMediaFromUrl({
    channel: "test",
    url: "http://127.0.0.1:4269/private.png",
    fileName: "../private.png",
  });
} catch (error) {
  blockedError = error instanceof Error ? error.message : String(error);
}
const fetchCallsAfterBlocked = fetched.length;

const saved = await saveInboundMediaFromUrl({
  channel: "test",
  url: "https://media.example.test/image",
  fileName: "../avatar",
  headers: { Authorization: "Bearer channel-token" },
});

console.log("@@REPORT@@" + JSON.stringify({
  blockedError,
  fetchCallsAfterBlocked,
  saved,
  fetched,
  savedUnderCybaraHome: saved.path.startsWith(cybaraDir),
}));
process.exit(0);
`;

let tempHome = "";
let report: MediaWorkerReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-media-test-"));
  const workerPath = join(tempHome, "media-worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
      LOG_LEVEL: "error",
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`media worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((entry) => entry.startsWith("@@REPORT@@"));
  if (!line) throw new Error(`no media report in worker output:\n${stdout}`);
  report = JSON.parse(line.slice("@@REPORT@@".length)) as MediaWorkerReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("channel inbound media downloads", () => {
  test("blocks private media URLs before fetch and stores allowed downloads safely", () => {
    expect(report.blockedError).toContain("media download blocked");
    expect(report.blockedError).toContain("127.0.0.1");
    expect(report.fetchCallsAfterBlocked).toBe(0);

    expect(report.fetched).toEqual([
      { url: "https://media.example.test/image", auth: "Bearer channel-token" },
    ]);
    expect(report.saved.bytes).toBe(4);
    expect(report.saved.contentType).toBe("image/png");
    expect(report.saved.path).toContain("/media/inbound/test/");
    expect(report.saved.path).not.toContain("..");
    expect(report.saved.path.endsWith(".png")).toBe(true);
    expect(report.savedUnderCybaraHome).toBe(true);
  });
});
