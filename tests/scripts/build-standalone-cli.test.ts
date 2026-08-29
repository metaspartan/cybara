import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildStandaloneCli,
  createStandaloneAssetsSource,
  createStandaloneEntrySource,
  standaloneCliBuildArgs,
} from "../../scripts/build-standalone-cli";

function currentBunTarget(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  return `bun-${platform}-${architecture}`;
}

describe("standalone CLI build", () => {
  test("uses the embedded entrypoint for every released OS and architecture", () => {
    const targets = [
      ["bun-darwin-x64", "cybara-darwin-x64"],
      ["bun-darwin-arm64", "cybara-darwin-arm64"],
      ["bun-linux-x64", "cybara-linux-x64"],
      ["bun-linux-arm64", "cybara-linux-arm64"],
      ["bun-windows-x64", "cybara-windows-x64.exe"],
      ["bun-windows-arm64", "cybara-windows-arm64.exe"],
    ] as const;

    for (const [target, outfile] of targets) {
      const args = standaloneCliBuildArgs(target, outfile, ".cybara-standalone-entry.ts");
      expect(args).toContain(".cybara-standalone-entry.ts");
      expect(args).toContain(`--target=${target}`);
      expect(args).toContain(`--outfile=${outfile}`);
      expect(args).toContain("@huggingface/transformers");
      expect(args).toContain("kokoro-js");
      expect(args).toContain("onnxruntime-node");
      expect(args).toContain("onnxruntime-web");
      expect(args).toContain("playwright");
      expect(args).toContain("playwright-core");
      expect(args).not.toContain("tiny-secp256k1");
    }
  });

  test("generates an entrypoint containing the complete production UI", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-standalone-entry-"));
    const uiDir = join(directory, "ui", "dist");
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    writeFileSync(join(uiDir, "index.html"), '<script src="/assets/app.js"></script>');
    writeFileSync(join(uiDir, "assets", "app.js"), "console.log('cybara')");

    try {
      const assetsModule = join(directory, ".cybara-assets.ts");
      const runtimeEntry = join(directory, ".cybara-runtime.js");
      const transformersWorker = join(directory, ".cybara-transformers-worker.mjs");
      const playwrightRuntimeArchive = join(directory, ".cybara-playwright.json.gz");
      writeFileSync(playwrightRuntimeArchive, "archive");
      const assetsSource = createStandaloneAssetsSource({
        cwd: directory,
        uiDir,
        runtimeEntry,
        transformersWorker,
        playwrightRuntimeArchive,
        playwrightRuntimeVersion: "runtime-v1",
      });
      expect(assetsSource).toContain('with { type: "file" }');
      expect(assetsSource).toContain('"/assets/app.js"');
      expect(assetsSource).toContain("__CYBARA_EMBEDDED_UI__");
      expect(assetsSource).toContain("__CYBARA_RUNTIME_ASSETS__");
      expect(assetsSource).toContain("installEmbeddedPlaywrightRuntime");
      expect(assetsSource).toContain("CYBARA_PLAYWRIGHT_RESOURCE_DIR");
      expect(assetsSource).toContain('"runtime-v1"');
      expect(assetsSource).toContain("__CYBARA_INSTALL_PLAYWRIGHT_RUNTIME__");
      expect(assetsSource).not.toContain("await installEmbeddedPlaywrightRuntime()");

      const source = createStandaloneEntrySource({
        cwd: directory,
        agentEntry: join(directory, "src", "cli", "agent-entry.ts"),
        assetsModule,
        runtimeEntry,
        version: "1.2.3",
        buildCommit: "0123456789ABCDEF0123456789ABCDEF01234567",
      });
      expect(source).toContain('command === "--version"');
      expect(source).toContain('"1.2.3"');
      expect(source).toContain('if (serverCommand) await import("./.cybara-assets.ts")');
      expect(source).toContain('command === "agent" &&');
      expect(source).toContain('await import("./src/cli/agent-entry.ts")');
      expect(source).toContain('import embeddedRuntimeEntry from "./.cybara-runtime.js"');
      expect(source).toContain("await import(embeddedRuntimeEntry)");
      expect(source).toContain(
        'Object.assign(globalThis, { __CYBARA_BUILD_COMMIT__: "0123456789abcdef0123456789abcdef01234567" })'
      );
      expect(source).toContain('with { type: "file" }');

      const sidecarAssetsSource = createStandaloneAssetsSource({
        cwd: directory,
        uiDir,
        runtimeEntry: join(directory, "src", "index.js"),
      });
      expect(sidecarAssetsSource).not.toContain('from "./src/index.js"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("preserves the compiled commit outside the source checkout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-standalone-commit-"));
    const uiDir = join(directory, "ui", "dist");
    const runDirectory = join(directory, "run");
    const runtimeEntry = join(directory, "runtime.ts");
    const outfile = join(directory, process.platform === "win32" ? "cybara.exe" : "cybara");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const buildInfoModule = join(
      import.meta.dirname,
      "..",
      "..",
      "src",
      "core",
      "build-info.ts"
    ).replaceAll("\\", "/");
    mkdirSync(uiDir, { recursive: true });
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "1.2.3" }));
    writeFileSync(join(uiDir, "index.html"), "<main>Cybara</main>");
    writeFileSync(
      runtimeEntry,
      `import { getBuildProvenance } from ${JSON.stringify(buildInfoModule)}; console.log((await getBuildProvenance()).commit ?? "unavailable");`
    );

    try {
      await buildStandaloneCli({
        target: currentBunTarget(),
        outfile,
        cwd: directory,
        uiDir,
        entryModule: "runtime.ts",
        buildCommit: commit,
        externalPackages: ["playwright"],
      });
      if (process.platform !== "win32") chmodSync(outfile, 0o755);
      const processHandle = Bun.spawn([outfile], {
        cwd: runDirectory,
        env: { CYBARA_HOME: join(directory, "home") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutPromise = new Response(processHandle.stdout).text();
      const stderrPromise = new Response(processHandle.stderr).text();
      const exitCode = await processHandle.exited;
      const stderr = await stderrPromise;
      expect(exitCode, stderr).toBe(0);
      expect((await stdoutPromise).trim()).toBe(commit);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test("loads the embedded Playwright API outside the source checkout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-standalone-playwright-"));
    const uiDir = join(directory, "ui", "dist");
    const runDirectory = join(directory, "run");
    const outfile = join(directory, process.platform === "win32" ? "cybara.exe" : "cybara");
    mkdirSync(uiDir, { recursive: true });
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<main>Cybara</main>");

    try {
      await buildStandaloneCli({
        target: currentBunTarget(),
        outfile,
        uiDir,
        entryModule: "tests/fixtures/standalone-playwright-runtime.ts",
      });
      if (process.platform !== "win32") chmodSync(outfile, 0o755);
      const processHandle = Bun.spawn([outfile], {
        cwd: runDirectory,
        env: { CYBARA_HOME: join(directory, "home") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutPromise = new Response(processHandle.stdout).text();
      const stderrPromise = new Response(processHandle.stderr).text();
      const exitCode = await processHandle.exited;
      const stderr = await stderrPromise;
      expect(exitCode, stderr).toBe(0);
      expect((await stdoutPromise).trim()).toBe("function");
      expect(existsSync(join(directory, "home", "runtime", "playwright"))).toBeTrue();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
