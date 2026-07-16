import { afterEach, describe, expect, test } from "bun:test";
import { handleExecuteCode } from "../../src/core/tools/handlers/execute-code";

const SECRET_NAME = "CYBARA_EXECUTE_CODE_TEST_SECRET";

afterEach(() => {
  delete process.env[SECRET_NAME];
});

describe("execute_code process boundary", () => {
  test("runs JavaScript in a child process and captures explicit results", async () => {
    const result = await handleExecuteCode({
      code: "console.log('child output'); return { pid: process.pid, total: 2 + 3 };",
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("child output");
    expect(result.result).toEqual({ pid: expect.any(Number), total: 5 });
    expect((result.result as { pid: number }).pid).not.toBe(process.pid);
  });

  test("transpiles TypeScript before executing it", async () => {
    const result = await handleExecuteCode({
      language: "typescript",
      code: "const values: number[] = [2, 3, 5]; return values.reduce((sum, value) => sum + value, 0);",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toBe(10);
  });

  test("dispatches permitted Cybara tools through the parent process", async () => {
    const result = await handleExecuteCode(
      {
        code: "return await cybara.calc({ expression: '6 * 7' });",
      },
      {
        agentId: "execute-code-test",
        allowedToolNames: ["calc", "execute_code"],
      }
    );

    expect(result.ok).toBe(true);
    expect(result.result).toEqual(expect.objectContaining({ result: 42 }));
  });

  test("does not inherit gateway secrets", async () => {
    process.env[SECRET_NAME] = "must-not-reach-child";
    const result = await handleExecuteCode({
      code: `return process.env.${SECRET_NAME};`,
    });

    expect(result.ok).toBe(true);
    expect(result.result).toBeUndefined();
  });

  test("terminates synchronous infinite loops at the configured timeout", async () => {
    const startedAt = Date.now();
    const result = await handleExecuteCode({ code: "while (true) {}", timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 1000ms");
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });
});
