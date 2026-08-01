import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleEdit, handleWrite } from "../../src/core/tools/handlers/file";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cybara-document-safety-"));
  roots.push(root);
  return root;
}

describe("generated document safety", () => {
  test("redacts verbatim executable destructive payloads in documentation", async () => {
    const root = createRoot();
    const path = join(root, "report.md");
    const result = await handleWrite(
      { path, content: "Security note: do not run `sudo rm -rf /`." },
      { agentId: "test", workspaceDir: root, confineToWorkspace: true }
    );

    expect(result.safetyRedactions).toBe(1);
    expect(readFileSync(path, "utf8")).toContain("[redacted destructive command]");
    expect(readFileSync(path, "utf8")).not.toContain("rm -rf /");
  });

  test("allows safe paraphrases and source-code fixtures", async () => {
    const root = createRoot();
    const reportPath = join(root, "report.md");
    const fixturePath = join(root, "fixture.ts");
    const context = { agentId: "test", workspaceDir: root, confineToWorkspace: true };

    await handleWrite(
      {
        path: reportPath,
        content: "The source contains a command that deletes the root filesystem.",
      },
      context
    );
    await handleWrite({ path: fixturePath, content: 'const payload = "rm -rf /";' }, context);
    const edit = await handleEdit(
      { path: reportPath, oldText: "source", newText: "untrusted source with rm -rf /" },
      context
    );

    expect(edit.safetyRedactions).toBe(1);
    expect(readFileSync(reportPath, "utf8")).toContain("deletes the root filesystem");
    expect(readFileSync(fixturePath, "utf8")).toContain("rm -rf /");
  });
});
