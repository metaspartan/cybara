import { describe, expect, test } from "bun:test";
import { retryInstall, runPostinstall } from "../../scripts/postinstall";

describe("retryInstall", () => {
  test("succeeds on a later attempt after cleanup between tries", async () => {
    let attempts = 0;
    const cleanups: number[] = [];
    const warnings: string[] = [];

    await retryInstall(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('Fail extracting tarball for "expo-camera"');
      },
      {
        attempts: 3,
        label: "mobile bun install",
        cleanup: async (attempt) => {
          cleanups.push(attempt);
        },
        sleep: async () => {},
        warn: (message) => warnings.push(message),
      }
    );

    expect(attempts).toBe(3);
    expect(cleanups).toEqual([1, 2]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("attempt 1/3");
  });

  test("throws the last error once attempts are exhausted", async () => {
    let attempts = 0;
    await expect(
      retryInstall(
        async () => {
          attempts += 1;
          throw new Error(`boom ${attempts}`);
        },
        { attempts: 2, sleep: async () => {}, warn: () => {} }
      )
    ).rejects.toThrow("boom 2");
    expect(attempts).toBe(2);
  });

  test("a failing cleanup does not mask the retry", async () => {
    let attempts = 0;
    await retryInstall(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
      },
      {
        attempts: 2,
        cleanup: async () => {
          throw new Error("cleanup exploded");
        },
        sleep: async () => {},
        warn: () => {},
      }
    );
    expect(attempts).toBe(2);
  });
});

describe("postinstall flow", () => {
  test("runs UI and mobile install then Playwright install", async () => {
    const calls: string[] = [];
    const warnings: string[] = [];

    await runPostinstall({
      installUi: async () => {
        calls.push("ui");
      },
      installMobile: async () => {
        calls.push("mobile");
      },
      installPlaywright: async () => {
        calls.push("playwright");
      },
      warn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(calls).toEqual(["ui", "mobile", "playwright"]);
    expect(warnings).toHaveLength(0);
  });

  test("continues when Playwright install fails and emits warnings", async () => {
    const calls: string[] = [];
    const warnings: string[] = [];

    await runPostinstall({
      installUi: async () => {
        calls.push("ui");
      },
      installMobile: async () => {
        calls.push("mobile");
      },
      installPlaywright: async () => {
        calls.push("playwright");
        throw new Error("playwright install failed");
      },
      warn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(calls).toEqual(["ui", "mobile", "playwright"]);
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
        installMobile: async () => {},
        installPlaywright: async () => {},
        warn: () => {},
      })
    ).rejects.toThrow("ui install failed");
  });
});
