import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const worker = join(root, "tests", "fixtures", "session-crash-recovery-worker.ts");
const homes: string[] = [];

interface RecoveryProbe {
  content?: string;
  interrupted?: boolean;
  markerCount: number;
  toolCount: number;
  thoughtCount: number;
  firstTool?: { phase?: string; text?: string; toolCallId?: string };
  lastTool?: { phase?: string; text?: string; toolCallId?: string };
  interruption?: { phase?: string; text?: string; toolName?: string };
}

function runWorker(
  home: string,
  mode: "seed" | "read",
  sessionId: string
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, worker, mode, sessionId], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CYBARA_HOME: join(home, ".cybara"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function readProbe(home: string, sessionId: string): Promise<RecoveryProbe> {
  const child = runWorker(home, "read", sessionId);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .findLast((entry) => entry.trim().startsWith("{"));
  if (!line) throw new Error(`Recovery probe did not emit JSON: ${stdout}\n${stderr}`);
  return JSON.parse(line) as RecoveryProbe;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("long-running session crash recovery", () => {
  test("reconstructs more than 5000 ten-hour events after an abrupt gateway exit", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-crash-recovery-"));
    homes.push(home);
    const sessionId = `crash-recovery-${crypto.randomUUID()}`;
    const seeder = runWorker(home, "seed", sessionId);
    const [seedExitCode, seedStderr] = await Promise.all([
      seeder.exited,
      new Response(seeder.stderr).text(),
    ]);
    expect(seedExitCode, seedStderr).toBe(86);

    const database = new Database(join(home, ".cybara", "data", "platform.db"), {
      readonly: true,
    });
    const eventCount = database
      .query("SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?")
      .get(sessionId) as { count: number };
    database.close();
    expect(eventCount.count).toBeGreaterThan(6000);

    const firstRestart = await readProbe(home, sessionId);
    expect(firstRestart).toMatchObject({
      content: "Partial findings survived.",
      interrupted: true,
      markerCount: 1,
      toolCount: 3001,
      thoughtCount: 14,
      firstTool: { phase: "result", text: "Read file 0", toolCallId: "read-0" },
      lastTool: { phase: "result", text: "Read file 3000", toolCallId: "read-3000" },
      interruption: {
        phase: "blocked",
        text: "Turn interrupted when the gateway stopped.",
        toolName: "__interruption",
      },
    });

    const secondRestart = await readProbe(home, sessionId);
    expect(secondRestart).toEqual(firstRestart);
  }, 30000);
});
