import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  baseSubprocessEnvironment,
  buildContainerRuntimeEnvironment,
  buildHostSubprocessEnvironment,
  buildSubprocessEnvironment,
  sanitizeSubprocessEnvironment,
} from "../../src/core/subprocess-env";

describe("subprocess environment", () => {
  test("keeps runtime variables and removes provider credentials", () => {
    const environment = baseSubprocessEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "secret",
      ANTHROPIC_AUTH_TOKEN: "secret",
      CYBARA_API_KEY: "secret",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
    });
  });

  test("adds only explicit child overrides", () => {
    const environment = buildSubprocessEnvironment(
      { MCP_TOKEN: "scoped", EMPTY: undefined },
      { PATH: "/bin", PROVIDER_SECRET: "hidden" }
    );

    expect(environment).toEqual({ PATH: "/bin", MCP_TOKEN: "scoped" });
  });

  test("filters untrusted child overrides", () => {
    const environment = sanitizeSubprocessEnvironment({
      PATH: "/workspace/bin",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "secret",
      NODE_OPTIONS: "--require=/tmp/hook.js",
      LD_PRELOAD: "/tmp/hook.so",
      INVALID: 42,
    });

    expect(environment).toEqual({
      PATH: "/workspace/bin",
      LANG: "en_US.UTF-8",
    });
  });

  test("preserves container daemon routing without provider credentials", () => {
    const environment = buildContainerRuntimeEnvironment(
      { DOCKER_CONTEXT: "workspace" },
      {
        PATH: "/bin",
        DOCKER_HOST: "tcp://127.0.0.1:2375",
        DOCKER_CONTEXT: "desktop-linux",
        CONTAINER_HOST: "unix:///run/user/1000/podman.sock",
        DOCKER_AUTH_CONFIG: "secret",
        REGISTRY_AUTH_FILE: "/tmp/secret.json",
      }
    );

    expect(environment).toEqual({
      PATH: "/bin",
      DOCKER_HOST: "tcp://127.0.0.1:2375",
      DOCKER_CONTEXT: "workspace",
      CONTAINER_HOST: "unix:///run/user/1000/podman.sock",
    });
  });

  test("adds packaged and user runtimes to a restricted desktop PATH", () => {
    const resourceDir = mkdtempSync(join(tmpdir(), "cybara-runtime-path-"));
    const bundledRuntimeDir = join(resourceDir, "runtime");
    mkdirSync(bundledRuntimeDir);
    try {
      const environment = buildHostSubprocessEnvironment(
        {},
        {
          PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          CYBARA_RESOURCE_DIR: resourceDir,
        }
      );
      const pathKey = Object.keys(environment).find((name) => name.toUpperCase() === "PATH");
      const entries = (pathKey ? environment[pathKey] : "").split(delimiter);

      expect(entries).toContain(dirname(process.execPath));
      expect(entries).toContain(bundledRuntimeDir);
      if (process.platform === "darwin" && existsSync("/opt/homebrew/bin")) {
        expect(entries).toContain("/opt/homebrew/bin");
      }
    } finally {
      rmSync(resourceDir, { recursive: true, force: true });
    }
  });

  test("recovers common Windows developer tools from a stale desktop PATH", () => {
    const executableDirectories = new Set(
      [
        "C:\\Cybara",
        "C:\\Program Files\\GitHub CLI",
        "C:\\Program Files\\Git\\cmd",
        "C:\\Users\\test\\scoop\\shims",
        "C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links",
      ].map((path) => path.toLowerCase())
    );
    const environment = buildHostSubprocessEnvironment(
      {},
      {
        Path: "C:\\Windows\\System32",
        UserProfile: "C:\\Users\\test",
        ProgramFiles: "C:\\Program Files",
        LocalAppData: "C:\\Users\\test\\AppData\\Local",
      },
      {
        platform: "win32",
        executablePath: "C:\\Cybara\\cybara.exe",
        directoryExists: (path) => executableDirectories.has(path.toLowerCase()),
      }
    );
    const pathKey = Object.keys(environment).find((name) => name.toUpperCase() === "PATH");
    const entries = (pathKey ? environment[pathKey] : "").split(";");

    expect(entries).toContain("C:\\Program Files\\GitHub CLI");
    expect(entries).toContain("C:\\Program Files\\Git\\cmd");
    expect(entries).toContain("C:\\Users\\test\\scoop\\shims");
    expect(entries).toContain("C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links");
  });
});
