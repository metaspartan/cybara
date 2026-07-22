import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureIosSimulatorAutomation,
  getIosSimulatorAutomationStatus,
  IDB_CLIENT_VERSION,
  IDB_PYTHON_VERSION,
  iosSimulatorAutomationEnv,
  managedIdbRuntimeDir,
  resolveIosSimulatorAutomationPaths,
} from "../../src/core/mobile-simulator-idb";

describe("managed iOS simulator automation", () => {
  test("requires both IDB components before reporting direct interaction", () => {
    const rootDir = "/cybara";
    const client = "/home/test/.local/bin/idb";
    const files = new Set([client, "/opt/homebrew/bin/brew"]);
    const options = {
      exists: (path: string) => files.has(path),
      home: "/home/test",
      platform: "darwin" as const,
      rootDir,
      which: () => null,
    };

    expect(resolveIosSimulatorAutomationPaths(options)).toMatchObject({
      client,
      companion: null,
    });
    expect(getIosSimulatorAutomationStatus(options)).toMatchObject({
      clientInstalled: true,
      companionInstalled: false,
      installable: true,
      installed: false,
    });
  });

  test("rejects a managed client built with an incompatible Python runtime", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "cybara-idb-version-"));
    const runtimeDir = managedIdbRuntimeDir(rootDir);
    const client = join(runtimeDir, "bin", "idb");
    try {
      mkdirSync(join(runtimeDir, "bin"), { recursive: true });
      writeFileSync(client, "");
      writeFileSync(join(runtimeDir, ".version"), `fb-idb=${IDB_CLIENT_VERSION}\npython=3.14.2\n`);
      const paths = resolveIosSimulatorAutomationPaths({
        exists: (path: string) => path === client,
        home: "/home/test",
        platform: "darwin",
        rootDir,
        which: () => null,
      });
      expect(paths.client).toBeNull();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("installs the official companion and exact managed client once", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "cybara-idb-install-"));
    const client = join(managedIdbRuntimeDir(rootDir), "bin", "idb");
    const companion = "/opt/homebrew/bin/idb_companion";
    const brew = "/opt/homebrew/bin/brew";
    const uv = "/home/test/.local/bin/uv";
    const files = new Set([brew, uv]);
    const commands: Array<{ args: string[]; command: string; env: NodeJS.ProcessEnv }> = [];
    const options = {
      env: { PATH: "/usr/bin" },
      exists: (path: string) => files.has(path),
      home: "/home/test",
      platform: "darwin" as const,
      rootDir,
      runner: async (command: string, args: string[], env: NodeJS.ProcessEnv) => {
        commands.push({ args, command, env });
        if (command === brew && args[0] === "install") files.add(companion);
        if (command === uv) files.add(client);
        await Bun.sleep(5);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      which: () => null,
    };

    try {
      const [first, second] = await Promise.all([
        ensureIosSimulatorAutomation(options),
        ensureIosSimulatorAutomation(options),
      ]);

      expect(first).toEqual(second);
      expect(first).toMatchObject({ client, companion });
      expect(commands.map(({ args, command }) => [command, ...args])).toEqual([
        [brew, "tap", "facebook/fb"],
        [brew, "trust", "--tap", "facebook/fb"],
        [brew, "install", "idb-companion"],
        [
          uv,
          "tool",
          "install",
          "--force",
          "--managed-python",
          "--python",
          IDB_PYTHON_VERSION,
          `fb-idb==${IDB_CLIENT_VERSION}`,
        ],
      ]);
      expect(commands[3]?.env.UV_TOOL_BIN_DIR).toBe(join(managedIdbRuntimeDir(rootDir), "bin"));
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("prepends the IDB client and companion directories to subprocess PATH", () => {
    const env = iosSimulatorAutomationEnv(
      {
        brew: null,
        client: "/cybara/idb/bin/idb",
        companion: "/opt/homebrew/bin/idb_companion",
        uv: null,
      },
      { PATH: "/usr/bin" }
    );
    expect(env.PATH?.split(":")).toEqual(["/cybara/idb/bin", "/opt/homebrew/bin", "/usr/bin"]);
  });
});
