import { describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  buildSandboxedShellPlan,
  getSandboxRuntimeStatus,
  resolveSandboxRuntime,
} from "../../src/core/sandbox";
import { isWindows } from "../../src/core/platform";

describe("sandbox runtime planning", () => {
  test("returns direct shell plan when sandbox is disabled", () => {
    const previous = config.getSandboxRuntime();
    try {
      config.setSandboxRuntime({ enabled: false, provider: "auto", network: "deny" });
      const resolution = resolveSandboxRuntime();
      const plan = buildSandboxedShellPlan({
        command: "echo hello",
        workdir: process.cwd(),
      });

      expect(resolution.enabled).toBe(false);
      expect(plan.enabled).toBe(false);
      expect(plan.provider).toBeNull();
      if (isWindows()) {
        expect(plan.command[0].toLowerCase()).not.toBe("sh");
      } else {
        expect(plan.command[0]).toBe("sh");
      }
    } finally {
      config.setSandboxRuntime(previous);
    }
  });

  test("fails fast for incompatible explicit provider", () => {
    const previous = config.getSandboxRuntime();
    const incompatibleProvider = process.platform === "linux" ? "apple_sandbox" : "podman";
    try {
      config.setSandboxRuntime({
        enabled: true,
        provider: incompatibleProvider,
        network: "deny",
      });

      expect(() =>
        buildSandboxedShellPlan({
          command: "echo hello",
          workdir: process.cwd(),
        })
      ).toThrow();
    } finally {
      config.setSandboxRuntime(previous);
    }
  });

  test("supports explicit docker provider when available", () => {
    const previous = config.getSandboxRuntime();
    const hasDocker =
      Bun.spawnSync(["sh", "-lc", "command -v docker >/dev/null 2>&1"]).exitCode === 0;
    try {
      config.setSandboxRuntime({
        enabled: true,
        provider: "docker",
        network: "deny",
      });

      if (!hasDocker) {
        expect(() =>
          buildSandboxedShellPlan({
            command: "echo hello",
            workdir: process.cwd(),
          })
        ).toThrow();
        return;
      }

      const plan = buildSandboxedShellPlan({
        command: "echo hello",
        workdir: process.cwd(),
      });
      expect(plan.enabled).toBe(true);
      expect(plan.provider).toBe("docker");
      expect(plan.command[0]).toBe("docker");
    } finally {
      config.setSandboxRuntime(previous);
    }
  });

  test("uses an authorized temporary directory for Apple sandbox commands", () => {
    if (process.platform !== "darwin" || process.arch !== "arm64") return;
    const available = Bun.spawnSync(["sh", "-lc", "command -v sandbox-exec >/dev/null 2>&1"]);
    if (available.exitCode !== 0) return;
    const previous = config.getSandboxRuntime();
    try {
      config.setSandboxRuntime({ enabled: true, provider: "apple_sandbox", network: "deny" });
      const plan = buildSandboxedShellPlan({ command: "echo hello", workdir: process.cwd() });
      expect(plan.env.TMPDIR).toBe("/tmp");
      expect(plan.env.TMP).toBe("/tmp");
      expect(plan.env.TEMP).toBe("/tmp");
    } finally {
      config.setSandboxRuntime(previous);
    }
  });

  test("reports provider diagnostics and resolution details", () => {
    const previous = config.getSandboxRuntime();
    try {
      config.setSandboxRuntime({
        enabled: true,
        provider: "docker",
        network: "deny",
      });
      const status = getSandboxRuntimeStatus();
      expect(status.enabled).toBe(true);
      expect(status.configuredProvider).toBe("docker");
      expect(Array.isArray(status.providers)).toBe(true);
      expect(status.providers.length).toBeGreaterThan(0);
      expect(status.providers.some((entry) => entry.provider === "docker")).toBe(true);
      if (!status.resolvedProvider) {
        expect(typeof status.reason).toBe("string");
      }
    } finally {
      config.setSandboxRuntime(previous);
    }
  });
});
