import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LSP_REGISTRY,
  managedLSPPaths,
  resolveManagedLSPCommand,
  resolvePackageBinary,
} from "../../src/core/lsp/installer";
import { getLanguageId } from "../../src/core/lsp/types";
import { resolveLspCommandCandidates } from "../../src/core/lsp/manager";

describe("portable LSP installation", () => {
  test("resolves scoped package bin entry points", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-lsp-package-"));
    const packageRoot = join(root, "node_modules", "@vtsls", "language-server");
    try {
      mkdirSync(join(packageRoot, "bin"), { recursive: true });
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ bin: { vtsls: "bin/vtsls.js" } })
      );
      writeFileSync(join(packageRoot, "bin", "vtsls.js"), "process.exit(0)");

      expect(resolvePackageBinary(root, "@vtsls/language-server", "vtsls")).toBe(
        join(packageRoot, "bin", "vtsls.js")
      );
      expect(resolvePackageBinary(root, "@vtsls/language-server", "missing")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prefers Cybara-managed launchers over PATH commands", () => {
    expect(
      resolveManagedLSPCommand("vtsls", (language) =>
        language === "vtsls" ? "C:\\Users\\Carsen\\.cybara\\lsp\\vtsls.cmd" : null
      )
    ).toBe("C:\\Users\\Carsen\\.cybara\\lsp\\vtsls.cmd");
    expect(resolveManagedLSPCommand("custom-lsp", () => null)).toBe("custom-lsp");
  });

  test("tracks every Windows launcher form for cleanup and discovery", () => {
    expect(managedLSPPaths("C:\\lsp", "vtsls", "win32")).toEqual([
      "C:\\lsp/vtsls",
      "C:\\lsp/vtsls.exe",
      "C:\\lsp/vtsls.cmd",
      "C:\\lsp/vtsls.bat",
    ]);
  });

  test("registers portable web and configuration language servers", () => {
    expect(LSP_REGISTRY.vtsls.installPackage).toBe("@vtsls/language-server");
    expect(LSP_REGISTRY.vue.binaryName).toBe("vue-language-server");
    expect(LSP_REGISTRY.svelte.binaryName).toBe("svelteserver");
    expect(LSP_REGISTRY.yaml.binaryName).toBe("yaml-language-server");
    expect(LSP_REGISTRY.shellscript.binaryName).toBe("bash-language-server");
    expect(LSP_REGISTRY.dockerfile.binaryName).toBe("docker-langserver");
  });

  test("includes upstream Windows artifacts where available", () => {
    expect(LSP_REGISTRY.rust.downloadUrls?.win32_x64).toEndWith("windows-msvc.zip");
    expect(LSP_REGISTRY.cpp.downloadUrls?.win32_x64).toContain("clangd-windows");
    expect(LSP_REGISTRY.csharp.downloadUrls?.win32_arm64).toContain("win-arm64");
    expect(LSP_REGISTRY.lua.downloadUrls?.win32_x64).toContain("win32-x64");
    expect(LSP_REGISTRY.zig.downloadUrls?.win32_arm64).toContain("aarch64-windows");
  });

  test("routes new file types to their language servers", () => {
    expect(getLanguageId("src/App.vue")).toBe("vue");
    expect(getLanguageId("src/App.svelte")).toBe("svelte");
    expect(getLanguageId("config.yaml")).toBe("yaml");
    expect(getLanguageId("scripts/build.sh")).toBe("shellscript");
    expect(getLanguageId("Dockerfile")).toBe("dockerfile");
    expect(getLanguageId("docker/Dockerfile.dev")).toBe("dockerfile");
  });

  test("upgrades legacy generated TypeScript commands to managed VTSLS", () => {
    expect(
      resolveLspCommandCandidates(
        "typescript",
        {
          command: "typescript-language-server",
          fallbackCommands: ["typescript-language-server"],
        },
        true
      )
    ).toEqual(["vtsls", "typescript-language-server"]);
    expect(
      resolveLspCommandCandidates("typescript", { command: "custom-typescript-lsp" }, true)
    ).toEqual(["custom-typescript-lsp"]);
  });
});
