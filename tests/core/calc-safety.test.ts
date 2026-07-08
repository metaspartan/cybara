import { describe, expect, test } from "bun:test";
import { handleCalc } from "../../src/core/tools/handlers/calc";

async function calc(expression: string): Promise<number> {
  const result = (await handleCalc({ expression })) as { result: number };
  return result.result;
}

describe("handleCalc arithmetic", () => {
  test("basic operators and precedence", async () => {
    expect(await calc("1 + 2 * 3")).toBe(7);
    expect(await calc("(1 + 2) * 3")).toBe(9);
    expect(await calc("10 / 4")).toBe(2.5);
    expect(await calc("10 % 3")).toBe(1);
    expect(await calc("-5 + 3")).toBe(-2);
    expect(await calc("2 ^ 10")).toBe(1024);
    expect(await calc("2 ** 3")).toBe(8);
  });

  test("right-associative power", async () => {
    expect(await calc("2 ^ 3 ^ 2")).toBe(512);
  });

  test("functions and constants", async () => {
    expect(await calc("sqrt(16)")).toBe(4);
    expect(await calc("pow(2, 8)")).toBe(256);
    expect(await calc("max(1, 5, 3)")).toBe(5);
    expect(await calc("min(4, 2, 9)")).toBe(2);
    expect(await calc("abs(-7)")).toBe(7);
    expect(Math.abs((await calc("pi")) - Math.PI)).toBeLessThan(1e-9);
    expect(await calc("floor(3.9)")).toBe(3);
  });

  test("scientific notation", async () => {
    expect(await calc("1e3 + 1")).toBe(1001);
  });
});

describe("handleCalc rejects code injection", () => {
  const payloads = [
    "require('child_process').execSync('id')",
    "globalThis.process.exit(1)",
    "process.mainModule",
    "alert(1)",
    "fetch('http://evil')",
    "constructor.constructor('return 1')()",
    "(() => 1)()",
    "this.constructor",
    "[].map",
    "1;2",
    "console.log(1)",
  ];
  for (const payload of payloads) {
    test(`throws on: ${payload}`, async () => {
      await expect(handleCalc({ expression: payload })).rejects.toThrow();
    });
  }

  test("does not execute side effects", async () => {
    (globalThis as Record<string, unknown>).__calcPwned = false;
    await expect(
      handleCalc({ expression: "__calcPwned = true" })
    ).rejects.toThrow();
    expect((globalThis as Record<string, unknown>).__calcPwned).toBe(false);
  });
});
