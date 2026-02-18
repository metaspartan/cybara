import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { executeTool } from "../../src/core/tools/handlers/index";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Tool permission enforcement", () => {
  test("denies execution when required permission is missing and enforcement is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-tool-perms-"));
    tempDirs.push(dir);
    const filePath = join(dir, "notes.txt");
    writeFileSync(filePath, "hello");

    await expect(
      executeTool(
        "read",
        { path: filePath },
        {
          agentId: "agent-perm-deny",
          permissions: ["net:fetch"],
          enforcePermissions: true,
        }
      )
    ).rejects.toThrow("Permission denied");
  });

  test("allows execution when required permission is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-tool-perms-"));
    tempDirs.push(dir);
    const filePath = join(dir, "allowed.txt");
    writeFileSync(filePath, "permission-ok");

    const result = (await executeTool(
      "read",
      { path: filePath },
      {
        agentId: "agent-perm-allow",
        permissions: ["fs:read"],
        enforcePermissions: true,
      }
    )) as { content: string; path: string };

    expect(result.content).toBe("permission-ok");
    expect(result.path).toBe(filePath);
  });

  test("keeps legacy behavior when permission enforcement is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-tool-perms-"));
    tempDirs.push(dir);
    const filePath = join(dir, "legacy.txt");
    writeFileSync(filePath, "legacy-ok");

    const result = (await executeTool(
      "read",
      { path: filePath },
      {
        agentId: "agent-perm-legacy",
        permissions: [],
        enforcePermissions: false,
      }
    )) as { content: string };

    expect(result.content).toBe("legacy-ok");
  });
});
