import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getWorkspaceLspStatus } from "../../src/api/routes/lsp-ide";
import { getLSPManager, initLSPManager } from "../../src/core/lsp";

const roots: string[] = [];

function workspace(name: string): string {
  const root = join(homedir(), `.cybara-lsp-status-${name}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  roots.push(root);
  return root;
}

afterEach(async () => {
  try {
    await getLSPManager().shutdown();
  } catch {}
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace LSP status", () => {
  test("reads matching workspace state without replacing the manager", () => {
    const activeWorkspace = workspace("active");
    initLSPManager(activeWorkspace);

    const status = getWorkspaceLspStatus(activeWorkspace);

    expect(status.workspace).toBe(activeWorkspace);
    expect(status.active).toEqual([]);
    expect(getLSPManager().getWorkspacePath()).toBe(activeWorkspace);
  });

  test("returns no active servers for another workspace without switching managers", () => {
    const activeWorkspace = workspace("active");
    const otherWorkspace = workspace("other");
    initLSPManager(activeWorkspace);

    const status = getWorkspaceLspStatus(otherWorkspace);

    expect(status.workspace).toBe(otherWorkspace);
    expect(status.active).toEqual([]);
    expect(getLSPManager().getWorkspacePath()).toBe(activeWorkspace);
  });
});
