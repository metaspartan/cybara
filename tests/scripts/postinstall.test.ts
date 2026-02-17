import { describe, expect, test } from "bun:test";
import { runPostinstall } from "../../scripts/postinstall";

describe("postinstall flow", () => {
  test("runs UI install then Playwright install", async () => {
    const calls: string[] = [];
    const warnings: string[] = [];

    await runPostinstall({
      installUi: async () => {
        calls.push("ui");
      },
      installPlaywright: async () => {
        calls.push("playwright");
      },
      warn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(calls).toEqual(["ui", "playwright"]);
    expect(warnings).toHaveLength(0);
  });

  test("continues when Playwright install fails and emits warnings", async () => {
    const calls: string[] = [];
    const warnings: string[] = [];

    await runPostinstall({
      installUi: async () => {
        calls.push("ui");
      },
      installPlaywright: async () => {
        calls.push("playwright");
        throw new Error("playwright install failed");
      },
      warn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(calls).toEqual(["ui", "playwright"]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("Playwright browser install skipped");
    expect(warnings[2]).toContain("playwright install failed");
  });

  test("throws when UI install fails", async () => {
    expect(
      runPostinstall({
        installUi: async () => {
          throw new Error("ui install failed");
        },
        installPlaywright: async () => {},
        warn: () => {},
      })
    ).rejects.toThrow("ui install failed");
  });
});
