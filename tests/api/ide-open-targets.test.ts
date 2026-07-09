import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { listWorkspaceOpenTargets, openWorkspaceTarget } from "../../src/api/ide-api";

let workDir: string | null = null;

function createWorkspace(): string {
  workDir = mkdtempSync(join(homedir(), ".cybara-ide-open-targets-"));
  return workDir;
}

describe("IDE workspace open targets", () => {
  afterEach(() => {
    if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  });

  test("lists Cybara IDE and platform openers for a valid workspace", async () => {
    const root = createWorkspace();
    const result = await listWorkspaceOpenTargets(root);

    expect(result.success).toBe(true);
    expect(result.path).toBe(root);
    expect(result.targets.some((target) => target.id === "cybara_ide")).toBe(true);
    expect(result.targets.every((target) => target.available)).toBe(true);
  });

  test("rejects paths outside the allowed home workspace boundary", async () => {
    const result = await listWorkspaceOpenTargets("/etc");

    expect(result.success).toBe(false);
    expect(result.targets).toEqual([]);
    expect(result.error).toContain("Access denied");
  });

  test("opens the internal Cybara IDE target without spawning an external app", async () => {
    const root = createWorkspace();
    const result = await openWorkspaceTarget(root, "cybara_ide");

    expect(result).toEqual({ success: true, path: root });
  });

  test("rejects unsupported open target ids", async () => {
    const root = createWorkspace();
    const result = await openWorkspaceTarget(root, "arbitrary-shell-command");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported open target");
  });
});
