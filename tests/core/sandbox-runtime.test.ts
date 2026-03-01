import { describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import { buildSandboxedShellPlan, resolveSandboxRuntime } from "../../src/core/sandbox";

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
      expect(plan.command[0]).toBe("sh");
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
});
