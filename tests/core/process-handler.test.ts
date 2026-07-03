import { describe, expect, test } from "bun:test";
import { handleExecAsync, handleProcess } from "../../src/core/tools/handlers/process";

type ProcListEntry = { sessionId: string; command: string; startedAt: string };

async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 3000
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("handleExecAsync", () => {
  test("runs a command and returns its output + exit code", async () => {
    const result = await handleExecAsync({ command: "echo cybara-async-ok" });
    expect(result.output).toContain("cybara-async-ok");
    expect(result.exitCode).toBe(0);
    expect(result.pid).toBeGreaterThan(0);
  });

  test("requires a command", async () => {
    const result = await handleExecAsync({ command: "" });
    expect(result.exitCode).toBe(2);
    expect(result.output.toLowerCase()).toContain("command is required");
  });
});

describe("handleProcess kill actually terminates the process", () => {
  test("list surfaces a running async process and kill stops it", async () => {
    // Start a long sleep but DON'T await it — it stays running.
    const running = handleExecAsync({ command: "sleep 30" });

    // It should appear in the process list while running.
    const found = await waitFor(async () => {
      const list = (await handleProcess({ action: "list" })) as ProcListEntry[];
      return list.find((p) => p.command.includes("sleep 30"));
    });
    expect(found).toBeDefined();

    // Kill it by its pid/sessionId — this must terminate the process.
    const killed = (await handleProcess({
      action: "kill",
      sessionId: found.sessionId,
    })) as { success: boolean; pid?: number };
    expect(killed.success).toBe(true);

    // The still-pending async exec now resolves with a non-zero (killed) code,
    // proving the process was actually terminated rather than just forgotten.
    const result = await running;
    expect(result.exitCode).not.toBe(0);

    // And it is gone from the list.
    const after = (await handleProcess({ action: "list" })) as ProcListEntry[];
    expect(after.find((p) => p.sessionId === found.sessionId)).toBeUndefined();
  });

  test("killing an unknown id fails cleanly", async () => {
    const res = (await handleProcess({ action: "kill", sessionId: "does-not-exist" })) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
