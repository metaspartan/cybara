import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildStandaloneCli } from "../../scripts/build-standalone-cli";

function currentBunTarget(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `bun-${platform}-${process.arch}`;
}

function availablePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitForDashboard(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw lastError instanceof Error ? lastError : new Error("Compiled dashboard did not start");
}

describe("compiled CLI startup", () => {
  test("serves embedded UI assets with production authentication from a standalone release", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-compiled-cli-startup-"));
    const binary = join(directory, process.platform === "win32" ? "cybara.exe" : "cybara");
    const home = join(directory, "home");
    const cybaraHome = join(home, ".cybara");
    const uiDir = join(directory, "fixture-ui");
    const port = availablePort();
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    mkdirSync(cybaraHome, { recursive: true });
    writeFileSync(
      join(uiDir, "index.html"),
      '<!doctype html><html><body><main id="compiled-ui-marker"></main><script type="module" src="/assets/app.js"></script></body></html>'
    );
    writeFileSync(join(uiDir, "assets", "app.js"), "globalThis.cybaraEmbeddedUi = true;");

    let processHandle: ReturnType<typeof Bun.spawn> | undefined;
    let stdoutPromise: Promise<string> | undefined;
    let stderrPromise: Promise<string> | undefined;

    try {
      await buildStandaloneCli({
        target: currentBunTarget(),
        outfile: binary,
        cwd: process.cwd(),
        uiDir,
      });

      const environment = { ...process.env };
      delete environment.NODE_ENV;
      delete environment.CYBARA_REQUIRE_AUTH;
      environment.HOME = home;
      environment.USERPROFILE = home;
      environment.CYBARA_HOME = cybaraHome;
      environment.PORT = String(port);

      const version = Bun.spawnSync([binary, "version"], { cwd: directory, env: environment });
      expect(version.exitCode).toBe(0);
      expect(version.stdout.toString()).toMatch(/^cybara v\d+\.\d+\.\d+/);
      expect(version.stderr.toString()).not.toContain("Cannot find module");

      const help = Bun.spawnSync([binary, "help"], { cwd: directory, env: environment });
      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toContain("CYBARA CLI");
      expect(help.stderr.toString()).not.toContain("Cannot find module");

      const status = Bun.spawnSync([binary, "status"], { cwd: directory, env: environment });
      expect(status.stderr.toString()).not.toContain("Cannot find module");

      processHandle = Bun.spawn([binary, "start", "--port", String(port)], {
        cwd: directory,
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      });
      stdoutPromise = new Response(processHandle.stdout).text();
      stderrPromise = new Response(processHandle.stderr).text();

      const dashboard = await waitForDashboard(`http://127.0.0.1:${port}/`);
      expect(await dashboard.text()).toContain('id="compiled-ui-marker"');

      const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("application/javascript");
      expect(await asset.text()).toContain("cybaraEmbeddedUi");

      const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
        headers: { Origin: `http://127.0.0.1:${port}` },
      });
      expect(protectedResponse.status).toBe(401);
    } finally {
      processHandle?.kill();
      if (processHandle) await processHandle.exited;
      const logs = `${stdoutPromise ? await stdoutPromise : ""}\n${stderrPromise ? await stderrPromise : ""}`;
      expect(logs).not.toContain("Failed to load UI index");
      expect(logs).not.toContain("Localhost browser auth bypass is active for development");
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
