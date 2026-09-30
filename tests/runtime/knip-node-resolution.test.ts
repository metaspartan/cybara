import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const KNIP_SCRIPT = join(REPO_ROOT, "scripts", "run-knip.sh");
const IS_WINDOWS = process.platform === "win32";

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function readScript(): string {
  return readFileSync(KNIP_SCRIPT, "utf8");
}

function runWithStubNode(version: string): { cleanup: () => void; result: RunResult } {
  const dir = mkdtempSync(join(tmpdir(), "cybara-knip-"));
  const nodePath = join(dir, "node");
  writeFileSync(
    nodePath,
    `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho "RESOLVED_NODE cli=$1 args=$*"\nexit 0\n`,
    "utf8"
  );
  chmodSync(nodePath, 0o755);

  const result = Bun.spawnSync(["/bin/bash", KNIP_SCRIPT, "--no-progress"], {
    cwd: REPO_ROOT,
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    result: {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    },
  };
}

describe.skipIf(IS_WINDOWS)("knip node version gate", () => {
  test("resolves and executes a node that meets the minimum version", () => {
    const { cleanup, result } = runWithStubNode("v22.21.1");
    try {
      expect(result.stdout).toContain("RESOLVED_NODE");
      expect(result.stdout).toContain("knip/dist/cli.js");
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("passes caller arguments through to the resolved node", () => {
    const { cleanup, result } = runWithStubNode("v22.21.1");
    try {
      expect(result.stdout).toContain("--no-progress");
    } finally {
      cleanup();
    }
  });

  test("rejects a node below the 22.12 minimum on the 22 major line", () => {
    const { cleanup, result } = runWithStubNode("v22.9.0");
    try {
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("knip requires Node >= 22.12");
      expect(result.stdout).not.toContain("RESOLVED_NODE");
    } finally {
      cleanup();
    }
  });

  test("rejects a node below 22", () => {
    const { cleanup, result } = runWithStubNode("v20.11.0");
    try {
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("knip requires Node >= 22.12");
    } finally {
      cleanup();
    }
  });

  test("accepts a newer major line", () => {
    const { cleanup, result } = runWithStubNode("v24.3.0");
    try {
      expect(result.stdout).toContain("RESOLVED_NODE");
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });
});

describe("knip windows node resolution", () => {
  test("resolves node through Windows interop when the POSIX PATH has none", () => {
    const script = readScript();
    expect(script).toContain("cmd.exe /c where node");
    expect(script).toContain("wslpath -u");
  });

  test("converts the knip entrypoint when the resolved node is a Windows binary", () => {
    const script = readScript();
    expect(script).toContain("knip_node_is_windows");
    expect(script).toContain("wslpath -w");
  });

  test("probes the node version by executing it instead of testing the execute bit", () => {
    const script = readScript();
    expect(script).not.toContain('[ -x "$node_bin" ]');
    expect(script).toContain('version="$("$node_bin" --version 2>/dev/null)"');
  });
});
