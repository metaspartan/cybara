import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isPathAllowed, writeFileContent } from "../../src/api/ide-api";

let workDir: string | null = null;

describe("IDE path allow-check symlink escape (TOCTOU)", () => {
  afterEach(() => {
    if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  });

  test("a real file under $HOME is allowed", () => {
    workDir = mkdtempSync(join(homedir(), ".cybara-ide-test-"));
    const real = join(workDir, "notes.txt");
    writeFileSync(real, "hello");
    expect(isPathAllowed(real)).toBe(true);
  });

  test("a symlink under $HOME pointing outside $HOME is rejected", () => {
    workDir = mkdtempSync(join(homedir(), ".cybara-ide-test-"));
    const link = join(workDir, "escape");
    symlinkSync("/etc/passwd", link);
    expect(isPathAllowed(link)).toBe(false);
  });

  test("a not-yet-created file inside a symlinked-out directory is rejected", () => {
    workDir = mkdtempSync(join(homedir(), ".cybara-ide-test-"));
    const linkedDir = join(workDir, "outdir");
    symlinkSync("/etc", linkedDir);
    const wouldWrite = join(linkedDir, "newfile.txt");
    expect(isPathAllowed(wouldWrite)).toBe(false);
  });

  test("a not-yet-created file in a real $HOME dir is allowed", () => {
    workDir = mkdtempSync(join(homedir(), ".cybara-ide-test-"));
    expect(isPathAllowed(join(workDir, "brand-new.txt"))).toBe(true);
  });

  test("write rejects a final symlink even when its target is inside HOME", async () => {
    workDir = mkdtempSync(join(homedir(), ".cybara-ide-test-"));
    const target = join(workDir, "target.txt");
    const link = join(workDir, "link.txt");
    writeFileSync(target, "original");
    try {
      symlinkSync(target, link);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return;
      throw error;
    }
    const result = await writeFileContent(link, "replaced");
    expect(result.success).toBe(false);
    expect(result.error).toContain("symbolic link");
    expect(await Bun.file(target).text()).toBe("original");
  });
});
