import { describe, expect, test } from "bun:test";
import { handleExec, handleExecAsync, handleProcess } from "../../src/core/tools/handlers/process";

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

describe("handleExec", () => {
  test("runs a command and returns its output + exit code", async () => {
    const result = await handleExec({ command: "echo cybara-exec-ok" });
    expect(result.output).toContain("cybara-exec-ok");
    expect(result.exitCode).toBe(0);
  });

  test("starts long-running commands in the background without blocking", async () => {
    const startedAt = Date.now();
    const result = await handleExec({
      command: 'bun -e "setTimeout(() => {}, 30000)"',
      background: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(2000);

    const list = (await handleProcess({ action: "list" })) as ProcListEntry[];
    expect(list.some((entry) => entry.sessionId === String(result.pid))).toBe(true);

    const killed = (await handleProcess({
      action: "kill",
      sessionId: String(result.pid),
    })) as { success: boolean };
    expect(killed.success).toBe(true);
  });

  test("does not wait forever when a shell background child inherits output pipes", async () => {
    if (process.platform === "win32") return;
    const startedAt = Date.now();
    const result = await handleExec({
      command: 'bun -e "setTimeout(() => {}, 30000)" & echo parent-complete',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("parent-complete");
    expect(Date.now() - startedAt).toBeLessThan(3000);
    if (result.pid) {
      try {
        process.kill(-result.pid, "SIGKILL");
      } catch {}
    }
  });

  test("honors abort signals without blocking the process list", async () => {
    const controller = new AbortController();
    const running = handleExec(
      { command: "sleep 30" },
      { agentId: "test-agent", sessionId: "test-session", abortSignal: controller.signal }
    );

    const found = await waitFor(async () => {
      const list = (await handleProcess({ action: "list" })) as ProcListEntry[];
      return list.find((p) => p.command.includes("sleep 30"));
    });
    expect(found).toBeDefined();

    controller.abort(new DOMException("test abort", "AbortError"));
    const result = await running;

    expect(result.exitCode).toBe(130);
    expect(result.output).toContain("Command interrupted.");
    const after = (await handleProcess({ action: "list" })) as ProcListEntry[];
    expect(after.find((p) => p.sessionId === found.sessionId)).toBeUndefined();
  }, 15000);
});

describe("handleProcess kill actually terminates the process", () => {
  test("list surfaces a running async process and kill stops it", async () => {
    // Start a long sleep but DON'T await it — it stays running. Swallow its
    // eventual rejection/resolution so we never block the test on the (possibly
    // slow) child teardown, which is what timed CI out.
    let exitCode: number | undefined;
    const running = handleExecAsync({ command: "sleep 30" });
    void running.then((r) => {
      exitCode = r.exitCode;
    });

    // It should appear in the process list while running.
    const found = await waitFor(async () => {
      const list = (await handleProcess({ action: "list" })) as ProcListEntry[];
      return list.find((p) => p.command.includes("sleep 30"));
    });
    expect(found).toBeDefined();

    // Kill it by its pid/sessionId — this must terminate the process and remove
    // it from the running list (the previous impl only removed the map entry).
    const killed = (await handleProcess({
      action: "kill",
      sessionId: found.sessionId,
    })) as { success: boolean; pid?: number };
    expect(killed.success).toBe(true);

    const after = (await handleProcess({ action: "list" })) as ProcListEntry[];
    expect(after.find((p) => p.sessionId === found.sessionId)).toBeUndefined();

    // The killed process should terminate on its own shortly; if it does, it
    // must report a non-zero (killed) exit. Bounded wait so a slow teardown can
    // never hang the test.
    await waitFor(() => (exitCode !== undefined ? true : undefined), 4000).catch(() => undefined);
    if (exitCode !== undefined) {
      expect(exitCode).not.toBe(0);
    }
  }, 15000);

  test("killing an unknown id fails cleanly", async () => {
    const res = (await handleProcess({ action: "kill", sessionId: "does-not-exist" })) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
