import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findLspWorkspaceRoot,
  getLSPManager,
  peekLSPManager,
  restartLSPManager,
  shutdownAllLSPManagers,
} from "../../src/core/lsp";

const roots: string[] = [];

function createWorkspace(name: string): string {
  const root = join(tmpdir(), `cybara-lsp-${name}-${crypto.randomUUID()}`);
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "src", "nested", "sample.ts"), "export const value = 1;\n");
  roots.push(root);
  return root;
}

afterEach(async () => {
  await shutdownAllLSPManagers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace-scoped LSP managers", () => {
  test("finds the project root from a nested file", () => {
    const root = createWorkspace("root");
    expect(findLspWorkspaceRoot(join(root, "src", "nested", "sample.ts"))).toBe(realpathSync(root));
  });

  test("keeps independent managers for concurrent workspaces", () => {
    const firstRoot = createWorkspace("first");
    const secondRoot = createWorkspace("second");

    const first = getLSPManager(firstRoot);
    const second = getLSPManager(secondRoot);

    expect(first).not.toBe(second);
    expect(first.getWorkspacePath()).toBe(realpathSync(firstRoot));
    expect(second.getWorkspacePath()).toBe(realpathSync(secondRoot));
    expect(getLSPManager(firstRoot)).toBe(first);
    expect(peekLSPManager(secondRoot)).toBe(second);
  });

  test("restarts only the selected workspace manager", async () => {
    const firstRoot = createWorkspace("restart-first");
    const secondRoot = createWorkspace("restart-second");
    const first = getLSPManager(firstRoot);
    const second = getLSPManager(secondRoot);

    const restarted = await restartLSPManager(firstRoot);

    expect(restarted).not.toBe(first);
    expect(getLSPManager(firstRoot)).toBe(restarted);
    expect(getLSPManager(secondRoot)).toBe(second);
  });

  test("deduplicates concurrent language server startup", async () => {
    const root = createWorkspace("concurrent-start");
    const manager = getLSPManager(root);

    const clients = await Promise.all([
      manager.getClient("typescript"),
      manager.getClient("typescript"),
      manager.getClient("typescript"),
    ]);

    expect(clients[0]).not.toBeNull();
    expect(clients[1]).toBe(clients[0]);
    expect(clients[2]).toBe(clients[0]);
    expect(manager.getRunningServers().filter((server) => server.id === "typescript")).toHaveLength(
      1
    );
  });
});
