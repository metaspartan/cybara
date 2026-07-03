import { describe, expect, test } from "bun:test";
import { rawComputerUse } from "../../src/cli-computer-use";

async function captureConsoleLogs(run: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return logs;
}

describe("computer-use CLI output", () => {
  test("prints the cua-driver source when status includes it", async () => {
    const logs = await captureConsoleLogs(async () => {
      await rawComputerUse(
        ["computer-use", "status"],
        async <T>(endpoint: string): Promise<T | null> => {
          expect(endpoint).toBe("/api/computer-use/status");
          return {
            available: true,
            command: "C:\\Users\\carsen\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe",
            driverSource: "known-install-dir",
            configuredCommand: "C:\\Portable\\Cua\\cua-driver.exe",
            platform: "win32",
            version: "0.7.2",
            ready: true,
            message: "cua-driver is installed and healthy.",
          } as T;
        },
        "http://localhost:4269"
      );
    });

    expect(logs).toContain("  source:           known-install-dir");
    expect(logs).toContain("  configured path:  C:\\Portable\\Cua\\cua-driver.exe");
    expect(logs).toContain("  installed:        yes (0.7.2)");
    expect(logs).toContain("  platform:         win32");
  });

  test("setup requests the grant endpoint before printing status", async () => {
    const calls: Array<{ endpoint: string; method?: string }> = [];
    const logs = await captureConsoleLogs(async () => {
      await rawComputerUse(
        ["computer-use", "setup"],
        async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
          calls.push({ endpoint, method: options?.method });
          if (endpoint === "/api/computer-use/permissions/grant") {
            return { ok: true, message: "Requested TCC grants." } as T;
          }
          return {
            available: true,
            command: "/Users/carsen/.local/bin/cua-driver",
            driverSource: "path",
            platform: "darwin",
            accessibility: true,
            screenRecording: true,
            ready: true,
            message: "cua-driver is installed, healthy, and ready.",
          } as T;
        },
        "http://localhost:4269"
      );
    });

    expect(calls).toEqual([
      { endpoint: "/api/computer-use/permissions/grant", method: "POST" },
      { endpoint: "/api/computer-use/status", method: undefined },
    ]);
    expect(logs[0]).toBe("Requested TCC grants.");
    expect(logs).toContain("  source:           path");
  });
});
