import { describe, expect, test } from "bun:test";
import { truncateToolResultForTransport } from "../../src/api/routes/tool-result-transport";
import { sanitizeSessionMessages } from "../../src/api/routes/_shared";

describe("tool result transport shrinking", () => {
  test("keeps scalars and object shape so clients can still read fields", () => {
    const result = {
      output: "x".repeat(5_000),
      exitCode: 128,
      pid: 4242,
      cwd: "/tmp/project",
      ok: false,
    };
    const shrunk = truncateToolResultForTransport(result, { maxStringChars: 500 }) as Record<
      string,
      unknown
    >;

    expect(typeof shrunk).toBe("object");
    expect(shrunk.exitCode).toBe(128);
    expect(shrunk.pid).toBe(4242);
    expect(shrunk.cwd).toBe("/tmp/project");
    expect(shrunk.ok).toBe(false);
    expect(String(shrunk.output)).toHaveLength(500 + "... [truncated]".length);
    expect(String(shrunk.output).endsWith("... [truncated]")).toBe(true);
  });

  test("leaves small results untouched", () => {
    const result = { output: "done", exitCode: 0 };
    expect(truncateToolResultForTransport(result)).toEqual(result);
    expect(truncateToolResultForTransport("short")).toBe("short");
    expect(truncateToolResultForTransport(7)).toBe(7);
    expect(truncateToolResultForTransport(null)).toBeNull();
    expect(truncateToolResultForTransport(undefined)).toBeUndefined();
  });

  test("trims long arrays and notes how many were dropped", () => {
    const shrunk = truncateToolResultForTransport(
      { matches: Array.from({ length: 60 }, (_, index) => `hit-${index}`) },
      { maxArrayItems: 5 }
    ) as { matches: string[] };

    expect(shrunk.matches).toHaveLength(6);
    expect(shrunk.matches[5]).toContain("55 more item(s)");
  });

  test("shrinks strings harder instead of flattening an over-budget object", () => {
    const result = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`field${index}`, "y".repeat(400)])
    );
    const shrunk = truncateToolResultForTransport(
      { ...result, exitCode: 3 },
      {
        maxStringChars: 500,
        maxTotalChars: 4_000,
      }
    ) as Record<string, unknown>;

    expect(typeof shrunk).toBe("object");
    expect(shrunk.exitCode).toBe(3);
    expect(JSON.stringify(shrunk).length).toBeLessThanOrEqual(4_000);
  });

  test("sanitized session messages keep structured tool results", () => {
    const [message] = sanitizeSessionMessages([
      {
        role: "assistant",
        content: "ran the tests",
        tool_calls: [
          {
            id: "call-1",
            name: "exec",
            args: { cmd: "bun test" },
            result: {
              output: "z".repeat(4_000),
              exitCode: 1,
              cwd: "/tmp/work",
            },
          },
        ],
      },
    ]);

    const result = message.tool_calls?.[0]?.result as Record<string, unknown>;
    expect(typeof result).toBe("object");
    expect(result.exitCode).toBe(1);
    expect(result.cwd).toBe("/tmp/work");
    expect(String(result.output).length).toBeLessThan(1_000);
  });
});

describe("tool result transport caching", () => {
  test("reuses cached results for stable inputs and recomputes for changed options", () => {
    const result = { output: "z".repeat(2_000), exitCode: 0 };
    const first = truncateToolResultForTransport(result, { maxStringChars: 300 });
    const second = truncateToolResultForTransport(result, { maxStringChars: 300 });
    const different = truncateToolResultForTransport(result, { maxStringChars: 100 });
    expect(second).toEqual(first);
    expect(String((different as { output: unknown }).output).length).toBeLessThan(
      String((first as { output: unknown }).output).length
    );
  });

  test("stops walking oversized nested results early without flattening to a string", () => {
    const result: Record<string, unknown> = { ok: true };
    for (let i = 0; i < 5_000; i++) result[`field${i}`] = "y".repeat(2_000);
    const shrunk = truncateToolResultForTransport(result, {
      maxStringChars: 500,
      maxTotalChars: 4_000,
    }) as Record<string, unknown> | string;
    const serialized = typeof shrunk === "string" ? shrunk : JSON.stringify(shrunk);
    expect(serialized.length).toBeLessThanOrEqual(4_000 + "... [truncated]".length);
    if (typeof shrunk === "object") {
      expect(shrunk.ok).toBe(true);
    }
  });
});
