import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleRead } from "../../src/core/tools/handlers/file";

// When the model typos a path segment, the read error should suggest the
// corrected path so it self-corrects instead of retrying the same typo (the
// "Read failed" wall). Uses a real temp tree so the suggestion walks the FS.
// Typos here differ by >1 char (not case-only) to stay deterministic on
// case-insensitive filesystems.
let root = "";
let realFile = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cybara-suggest-"));
  mkdirSync(join(root, "alpha_service", "src"), { recursive: true });
  realFile = join(root, "alpha_service", "src", "main.ts");
  writeFileSync(realFile, "export const x = 1;\n", "utf8");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("read file-not-found suggestion", () => {
  test("suggests the correct segment for a close typo (alpha_srvice -> alpha_service)", async () => {
    const typo = join(root, "alpha_srvice", "src", "main.ts");
    let message = "";
    try {
      await handleRead({ path: typo });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("File not found");
    expect(message).toContain("Did you mean:");
    expect(message).toContain(realFile);
  });

  test("no suggestion when nothing is close (plain not-found)", async () => {
    const wild = join(root, "zqxwvu", "nope.ts");
    let message = "";
    try {
      await handleRead({ path: wild });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("File not found");
    expect(message).not.toContain("Did you mean:");
  });

  test("reads the real file without touching the suggestion path", async () => {
    const result = (await handleRead({ path: realFile })) as { content?: string };
    expect(result.content).toContain("export const x = 1;");
  });
});
