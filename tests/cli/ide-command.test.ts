import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runIdeCommand } from "../../src/cli/commands/ide";

describe("CLI IDE command", () => {
  test("prints or opens a canonical current-file URL", async () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-cli-ide-"));
    try {
      writeFileSync(join(root, "main.ts"), "export {};\n");
      const output: string[] = [];
      const printed = await runIdeCommand(["main.ts:9", "--print"], {
        apiBase: "http://127.0.0.1:4269",
        cwd: root,
        write: (line) => output.push(line),
      });
      expect(output).toEqual([printed]);
      expect(printed).toContain("path=");
      expect(printed).toContain("line=9");

      const opened: string[] = [];
      await runIdeCommand(["main.ts"], {
        apiBase: "http://127.0.0.1:4269",
        cwd: root,
        openUrl: async (url) => {
          opened.push(url);
        },
        write: () => undefined,
      });
      expect(opened).toHaveLength(1);
      expect(opened[0]).toContain("%2Fmain.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
