import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import {
  buildDockerRunArgs,
  sandboxCdpUrl,
  resolveSandboxContextDir,
  sandboxNovncUrl,
  SANDBOX_BROWSER_IMAGE,
  SANDBOX_BROWSER_CONTAINER,
} from "../../src/core/browser/sandbox-browser";

describe("sandbox browser launcher", () => {
  test("docker run publishes CDP and noVNC on loopback only", () => {
    const args = buildDockerRunArgs({
      image: SANDBOX_BROWSER_IMAGE,
      container: SANDBOX_BROWSER_CONTAINER,
      cdpPort: 9222,
      novncPort: 6080,
    });
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("-d");
    expect(args).toContain("127.0.0.1:9222:9222");
    expect(args).toContain("127.0.0.1:6080:6080");
    expect(args[args.length - 1]).toBe(SANDBOX_BROWSER_IMAGE);
    expect(args.some((a) => a === "0.0.0.0:9222:9222")).toBe(false);
  });

  test("cdp and novnc urls are loopback", () => {
    expect(sandboxCdpUrl(9333)).toBe("http://127.0.0.1:9333");
    expect(sandboxNovncUrl(6081)).toContain("http://127.0.0.1:6081/vnc.html");
    expect(sandboxNovncUrl(6081)).toContain("autoconnect=1");
  });

  test("resolves source and bundled sandbox contexts by Dockerfile presence", async () => {
    const savedResourceDir = process.env.CYBARA_RESOURCE_DIR;
    const savedConfiguredDir = process.env.CYBARA_SANDBOX_BROWSER_DIR;
    delete process.env.CYBARA_RESOURCE_DIR;
    delete process.env.CYBARA_SANDBOX_BROWSER_DIR;
    try {
      const root = mkdtempSync("/tmp/cybara-sandbox-context-");
      try {
        const sourceContext = `${root}/checkout/docker/sandbox-browser`;
        const bundledContext = `${root}/bundle/docker/sandbox-browser`;
        mkdirSync(sourceContext, { recursive: true });
        mkdirSync(bundledContext, { recursive: true });
        await Bun.write(`${sourceContext}/Dockerfile`, "FROM scratch\n");
        await Bun.write(`${bundledContext}/Dockerfile`, "FROM scratch\n");

        expect(
          resolveSandboxContextDir({
            cwd: `${root}/checkout`,
            execDir: `${root}/bin`,
            moduleDir: `${root}/checkout/src/core/browser`,
          })
        ).toBe(sourceContext);
        expect(
          resolveSandboxContextDir({
            cwd: `${root}/elsewhere`,
            execDir: `${root}/bin`,
            moduleDir: `${root}/bundle/dist`,
          })
        ).toBe(bundledContext);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      if (savedResourceDir === undefined) delete process.env.CYBARA_RESOURCE_DIR;
      else process.env.CYBARA_RESOURCE_DIR = savedResourceDir;
      if (savedConfiguredDir === undefined) delete process.env.CYBARA_SANDBOX_BROWSER_DIR;
      else process.env.CYBARA_SANDBOX_BROWSER_DIR = savedConfiguredDir;
    }
  });
});
