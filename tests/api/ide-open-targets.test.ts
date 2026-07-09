import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { listWorkspaceOpenTargets, openWorkspaceTarget } from "../../src/api/ide-api";

let workDir: string | null = null;
const ideApiSourcePath = fileURLToPath(new URL("../../src/api/ide-api.ts", import.meta.url));
const appIconDir = fileURLToPath(new URL("../../ui/public/app-icons/", import.meta.url));

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
    expect(result.targets.find((target) => target.id === "cybara_ide")?.iconUrl).toBe(
      "/cybara.png"
    );
    expect(result.targets.every((target) => target.available)).toBe(true);
    expect(new Set(result.targets.map((target) => target.id)).size).toBe(result.targets.length);
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

  test("Windows target detection avoids broad recursive Program Files scans", () => {
    const source = readFileSync(ideApiSourcePath, "utf8");

    expect(source).toContain("WORKSPACE_OPEN_TARGET_CACHE_MS");
    expect(source).toContain("windowsPathCommandPath");
    expect(source).toContain("windowsDirectExecutableCandidates");
    expect(source).toContain("findExecutableUnderKnownVendorRoots");
    expect(source).not.toContain("findNestedExecutable");
    expect(source).not.toContain("windowsProgramRoots().some((root)");
    expect(source).not.toContain('Bun.spawnSync(["where"');
  });

  test("workspace open targets use packaged icons for Windows and Linux targets", () => {
    const source = readFileSync(ideApiSourcePath, "utf8");
    const iconPaths = [
      "vscode.svg",
      "cursor.svg",
      "windsurf.svg",
      "zed.svg",
      "pearai.svg",
      "android-studio.svg",
      "jetbrains.svg",
      "explorer.svg",
      "terminal.svg",
      "files.svg",
    ];
    for (const iconPath of iconPaths) {
      expect(source).toContain(`/app-icons/${iconPath}`);
      expect(existsSync(join(appIconDir, iconPath))).toBe(true);
    }
  });
});
