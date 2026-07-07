import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { handleOcr } from "../../src/core/skills/ocr";

const isMac = process.platform === "darwin";
const SENTINEL_NAME = "cybara_ocr_injection_sentinel";
const SENTINEL = join(homedir(), SENTINEL_NAME);

function cleanup() {
  if (existsSync(SENTINEL)) rmSync(SENTINEL);
}

describe("OCR AppleScript/python injection", () => {
  afterEach(cleanup);

  test.if(isMac)(
    "malicious filename does not execute injected shell script",
    async () => {
      cleanup();
      const dir = mkdtempSync(join(tmpdir(), "cybara-ocr-"));
      const payload = `x" & (do shell script "cd ~ && touch ${SENTINEL_NAME}") & "`;
      const evilPath = join(dir, `${payload}.png`);
      writeFileSync(evilPath, "not a real image");

      try {
        await handleOcr({ path: evilPath });
      } catch {
        void 0;
      }

      expect(existsSync(SENTINEL)).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    },
    20_000
  );

  test("missing file is rejected before any spawn", async () => {
    await expect(handleOcr({ path: "/nonexistent/definitely/not/here.png" })).rejects.toThrow(
      /not found/i
    );
  });
});
