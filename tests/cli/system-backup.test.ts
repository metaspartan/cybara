import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { runSystemBackupCommand } from "../../src/cli/commands/system-backup";

interface RequestCall {
  endpoint: string;
  method: string;
}

const logSpy = spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  logSpy.mockClear();
});

describe("system backup CLI", () => {
  test("lists and creates backups through the root-scoped API", async () => {
    const calls: RequestCall[] = [];
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      calls.push({ endpoint, method: options?.method || "GET" });
      if (options?.method === "POST") {
        return {
          success: true,
          backup: {
            id: "backup_created_1234",
            label: "Before release",
            createdAt: "2026-07-11T00:00:00.000Z",
            entries: ["data"],
            bytes: 2048,
          },
        } as T;
      }
      return {
        backups: [],
        backupDirectory: "/tmp/backups",
        restore: { state: "idle" },
      } as T;
    };

    await runSystemBackupCommand(["list"], fetchAPI);
    await runSystemBackupCommand(["create", "--label", "Before release"], fetchAPI);

    expect(calls).toEqual([
      { endpoint: "/api/system/backups", method: "GET" },
      { endpoint: "/api/system/backups", method: "POST" },
    ]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Created backup_created_1234");
  });

  test("requires confirmation before restore and restarts after staging", async () => {
    const calls: RequestCall[] = [];
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      calls.push({ endpoint, method: options?.method || "GET" });
      return {
        success: true,
        restartRequired: endpoint.includes("/restore"),
        message: endpoint.endsWith("/restart") ? "Gateway restarting" : undefined,
      } as T;
    };

    await expect(
      runSystemBackupCommand(["restore", "backup_example_1234"], fetchAPI)
    ).rejects.toThrow("--yes");
    expect(calls).toHaveLength(0);

    await runSystemBackupCommand(["restore", "backup_example_1234", "--yes"], fetchAPI);
    expect(calls).toEqual([
      {
        endpoint: "/api/system/backups/backup_example_1234/restore",
        method: "POST",
      },
      { endpoint: "/api/system/restart", method: "POST" },
    ]);
  });
});
