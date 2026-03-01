import { existsSync, mkdirSync, unlinkSync, chmodSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { gunzipSync } from "zlib";

export function getLSPDir(): string {
  const dir = join(homedir(), ".cybara", "lsp");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getPlatform():
  | "darwin_arm64"
  | "darwin_x64"
  | "linux_x64"
  | "linux_arm64"
  | "win32_x64"
  | "win32_arm64"
  | "unsupported" {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "darwin_arm64";
  if (platform === "darwin" && arch === "x64") return "darwin_x64";
  if (platform === "linux" && arch === "x64") return "linux_x64";
  if (platform === "linux" && arch === "arm64") return "linux_arm64";
  if (platform === "win32" && arch === "x64") return "win32_x64";
  if (platform === "win32" && arch === "arm64") return "win32_arm64";
  return "unsupported";
}

export interface LSPInfo {
  name: string;
  displayName: string;
  description: string;
  type: "binary" | "pip" | "go" | "gem" | "bun" | "bundled";
  binaryName: string;
  installPackage?: string;
  downloadUrls?: Record<string, string>;
  installCommand?: string;
  requiresRuntime?: string;
  fileExtensions: string[];
}

export const LSP_REGISTRY: Record<string, LSPInfo> = {
  typescript: {
    name: "typescript",
    displayName: "TypeScript",
    description: "Bundled TypeScript Compiler API for diagnostics",
    type: "bundled",
    binaryName: "",
    fileExtensions: [".ts", ".tsx", ".mts", ".cts"],
  },
  javascript: {
    name: "javascript",
    displayName: "JavaScript",
    description: "Bundled TypeScript Compiler API for JS diagnostics",
    type: "bundled",
    binaryName: "",
    fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
  },
  vtsls: {
    name: "vtsls",
    displayName: "VTSLS",
    description: "vtsls - Faster TypeScript/JavaScript language server",
    type: "bun",
    binaryName: "vtsls",
    installPackage: "@vtsls/language-server",
    installCommand: "bun install -g @vtsls/language-server",
    requiresRuntime: "bun",
    fileExtensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  },
  tailwindcss: {
    name: "tailwindcss",
    displayName: "Tailwind CSS",
    description: "tailwindcss-language-server - IntelliSense for Tailwind CSS",
    type: "bun",
    binaryName: "tailwindcss-language-server",
    installPackage: "@tailwindcss/language-server",
    installCommand: "bun install -g @tailwindcss/language-server",
    requiresRuntime: "bun",
    fileExtensions: [".html", ".css", ".scss", ".ts", ".tsx", ".js", ".jsx"],
  },
  eslint: {
    name: "eslint",
    displayName: "ESLint",
    description: "vscode-eslint-language-server - ESLint language server",
    type: "bun",
    binaryName: "vscode-eslint-language-server",
    installPackage: "vscode-langservers-extracted",
    installCommand: "bun install -g vscode-langservers-extracted",
    requiresRuntime: "bun",
    fileExtensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
  },
  html: {
    name: "html",
    displayName: "HTML",
    description: "vscode-html-language-server - HTML language support",
    type: "bun",
    binaryName: "vscode-html-language-server",
    installPackage: "vscode-langservers-extracted",
    installCommand: "bun install -g vscode-langservers-extracted",
    requiresRuntime: "bun",
    fileExtensions: [".html", ".htm"],
  },
  css: {
    name: "css",
    displayName: "CSS",
    description: "vscode-css-language-server - CSS and SCSS language support",
    type: "bun",
    binaryName: "vscode-css-language-server",
    installPackage: "vscode-langservers-extracted",
    installCommand: "bun install -g vscode-langservers-extracted",
    requiresRuntime: "bun",
    fileExtensions: [".css", ".scss", ".less"],
  },
  json: {
    name: "json",
    displayName: "JSON",
    description: "vscode-json-language-server - JSON language support",
    type: "bun",
    binaryName: "vscode-json-language-server",
    installPackage: "vscode-langservers-extracted",
    installCommand: "bun install -g vscode-langservers-extracted",
    requiresRuntime: "bun",
    fileExtensions: [".json", ".jsonc"],
  },
  rust: {
    name: "rust",
    displayName: "Rust",
    description: "rust-analyzer - Fast and feature-rich LSP for Rust",
    type: "binary",
    binaryName: "rust-analyzer",
    downloadUrls: {
      darwin_arm64:
        "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-apple-darwin.gz",
      darwin_x64:
        "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-apple-darwin.gz",
      linux_x64:
        "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz",
      linux_arm64:
        "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-unknown-linux-gnu.gz",
    },
    fileExtensions: [".rs"],
  },
  go: {
    name: "go",
    displayName: "Go",
    description: "gopls - The official Go language server",
    type: "go",
    binaryName: "gopls",
    installCommand: "go install golang.org/x/tools/gopls@latest",
    requiresRuntime: "go",
    fileExtensions: [".go"],
  },
  python: {
    name: "python",
    displayName: "Python",
    description: "python-lsp-server - Python LSP implementation",
    type: "pip",
    binaryName: "pylsp",
    installCommand: "pip install python-lsp-server",
    requiresRuntime: "python3",
    fileExtensions: [".py", ".pyw"],
  },
  cpp: {
    name: "cpp",
    displayName: "C/C++",
    description: "clangd - LLVM-based C/C++ language server",
    type: "binary",
    binaryName: "clangd",
    downloadUrls: {
      darwin_arm64:
        "https://github.com/clangd/clangd/releases/download/21.1.8/clangd-mac-21.1.8.zip",
      darwin_x64: "https://github.com/clangd/clangd/releases/download/21.1.8/clangd-mac-21.1.8.zip",
      linux_x64:
        "https://github.com/clangd/clangd/releases/download/21.1.8/clangd-linux-21.1.8.zip",
      linux_arm64:
        "https://github.com/clangd/clangd/releases/download/21.1.8/clangd-linux-21.1.8.zip",
    },
    fileExtensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx"],
  },
  java: {
    name: "java",
    displayName: "Java",
    description: "Eclipse JDT Language Server for Java",
    type: "binary",
    binaryName: "jdtls",
    downloadUrls: {
      darwin_arm64:
        "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      darwin_x64: "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      linux_x64: "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      linux_arm64: "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
    },
    requiresRuntime: "java",
    fileExtensions: [".java"],
  },
  csharp: {
    name: "csharp",
    displayName: "C#",
    description: "OmniSharp - .NET development platform",
    type: "binary",
    binaryName: "OmniSharp",
    downloadUrls: {
      darwin_arm64:
        "https://github.com/OmniSharp/omnisharp-roslyn/releases/latest/download/omnisharp-osx-arm64-net6.0.tar.gz",
      darwin_x64:
        "https://github.com/OmniSharp/omnisharp-roslyn/releases/latest/download/omnisharp-osx-x64-net6.0.tar.gz",
      linux_x64:
        "https://github.com/OmniSharp/omnisharp-roslyn/releases/latest/download/omnisharp-linux-x64-net6.0.tar.gz",
      linux_arm64:
        "https://github.com/OmniSharp/omnisharp-roslyn/releases/latest/download/omnisharp-linux-arm64-net6.0.tar.gz",
    },
    fileExtensions: [".cs"],
  },
  ruby: {
    name: "ruby",
    displayName: "Ruby",
    description: "Solargraph - Ruby language server",
    type: "gem",
    binaryName: "solargraph",
    installCommand: "gem install solargraph",
    requiresRuntime: "ruby",
    fileExtensions: [".rb", ".rake", ".gemspec"],
  },
  php: {
    name: "php",
    displayName: "PHP",
    description: "Intelephense - PHP language server",
    type: "bun",
    binaryName: "intelephense",
    installCommand: "bun install -g intelephense",
    requiresRuntime: "bun",
    fileExtensions: [".php"],
  },
  lua: {
    name: "lua",
    displayName: "Lua",
    description: "lua-language-server - Feature-rich Lua LSP",
    type: "binary",
    binaryName: "lua-language-server",
    downloadUrls: {
      darwin_arm64:
        "https://github.com/LuaLS/lua-language-server/releases/download/3.17.1/lua-language-server-3.17.1-darwin-arm64.tar.gz",
      darwin_x64:
        "https://github.com/LuaLS/lua-language-server/releases/download/3.17.1/lua-language-server-3.17.1-darwin-x64.tar.gz",
      linux_x64:
        "https://github.com/LuaLS/lua-language-server/releases/download/3.17.1/lua-language-server-3.17.1-linux-x64.tar.gz",
      linux_arm64:
        "https://github.com/LuaLS/lua-language-server/releases/download/3.17.1/lua-language-server-3.17.1-linux-arm64.tar.gz",
    },
    fileExtensions: [".lua"],
  },
  zig: {
    name: "zig",
    displayName: "Zig",
    description: "zls - Zig Language Server",
    type: "binary",
    binaryName: "zls",
    downloadUrls: {
      darwin_arm64:
        "https://github.com/zigtools/zls/releases/latest/download/zls-aarch64-macos.tar.xz",
      darwin_x64:
        "https://github.com/zigtools/zls/releases/latest/download/zls-x86_64-macos.tar.xz",
      linux_x64: "https://github.com/zigtools/zls/releases/latest/download/zls-x86_64-linux.tar.xz",
      linux_arm64:
        "https://github.com/zigtools/zls/releases/latest/download/zls-aarch64-linux.tar.xz",
    },
    fileExtensions: [".zig"],
  },
  kotlin: {
    name: "kotlin",
    displayName: "Kotlin",
    description: "Kotlin Language Server from JetBrains - Intelligent code completion for Kotlin",
    type: "binary",
    binaryName: "kotlin-lsp.sh",
    downloadUrls: {
      darwin_arm64:
        "https://download-cdn.jetbrains.com/kotlin-lsp/261.13587.0/kotlin-lsp-261.13587.0-mac-aarch64.zip",
      darwin_x64:
        "https://download-cdn.jetbrains.com/kotlin-lsp/261.13587.0/kotlin-lsp-261.13587.0-mac-x64.zip",
      linux_x64:
        "https://download-cdn.jetbrains.com/kotlin-lsp/261.13587.0/kotlin-lsp-261.13587.0-linux-x64.zip",
      linux_arm64:
        "https://download-cdn.jetbrains.com/kotlin-lsp/261.13587.0/kotlin-lsp-261.13587.0-linux-aarch64.zip",
    },
    fileExtensions: [".kt", ".kts"],
  },
  swift: {
    name: "swift",
    displayName: "Swift",
    description: "sourcekit-lsp - Apple's LSP for Swift",
    type: "binary",
    binaryName: "sourcekit-lsp",
    downloadUrls: {},
    requiresRuntime: "swift",
    fileExtensions: [".swift"],
  },
};

export function getLSPPath(language: string): string | null {
  const info = LSP_REGISTRY[language];
  if (!info || info.type === "bundled") return null;

  const lspDir = getLSPDir();
  const binaryPath = join(lspDir, info.binaryName);

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  return null;
}

export function isInstalled(language: string): boolean {
  const info = LSP_REGISTRY[language];
  if (!info) return false;
  if (info.type === "bundled") return true;

  return getLSPPath(language) !== null;
}

export async function isAvailable(language: string): Promise<boolean> {
  const info = LSP_REGISTRY[language];
  if (!info) return false;
  if (info.type === "bundled") return true;

  if (isInstalled(language)) return true;

  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    const result = Bun.spawnSync([checkCmd, info.binaryName]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export interface LSPInstallStatus {
  language: string;
  displayName: string;
  description: string;
  type: "bundled" | "binary" | "pip" | "go" | "gem" | "bun";
  installed: boolean;
  available: boolean;
  path: string | null;
  requiresRuntime?: string;
}

export async function getInstallStatus(): Promise<LSPInstallStatus[]> {
  const results: LSPInstallStatus[] = [];

  for (const [lang, info] of Object.entries(LSP_REGISTRY)) {
    const installed = isInstalled(lang);
    const available = await isAvailable(lang);
    const path = getLSPPath(lang);

    results.push({
      language: lang,
      displayName: info.displayName,
      description: info.description,
      type: info.type,
      installed,
      available,
      path,
      requiresRuntime: info.requiresRuntime,
    });
  }

  return results;
}

export interface InstallResult {
  success: boolean;
  error?: string;
  path?: string;
}

export async function install(language: string): Promise<InstallResult> {
  const info = LSP_REGISTRY[language];
  if (!info) {
    return { success: false, error: `Unknown language: ${language}` };
  }

  if (info.type === "bundled") {
    return { success: true, path: "(bundled)" };
  }

  const lspDir = getLSPDir();

  try {
    if (info.type === "binary") {
      return await installBinary(info, lspDir);
    } else if (info.type === "go") {
      return await installGo(info, lspDir);
    } else if (info.type === "pip") {
      return await installPip(info, lspDir);
    } else if (info.type === "gem") {
      return await installGem(info, lspDir);
    } else if (info.type === "bun") {
      return await installBun(info, lspDir);
    }

    return { success: false, error: "Unknown install type" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function installBinary(info: LSPInfo, lspDir: string): Promise<InstallResult> {
  const platform = getPlatform();
  if (platform === "unsupported") {
    return { success: false, error: "Unsupported platform" };
  }

  const url = info.downloadUrls?.[platform];
  if (!url) {
    return { success: false, error: `No download available for ${platform}` };
  }

  console.log(`[LSP Installer] Downloading ${info.displayName} from ${url}...`);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    return { success: false, error: `Download failed: ${response.status}` };
  }

  const buffer = await response.arrayBuffer();
  const binaryPath = join(lspDir, info.binaryName);

  if (url.endsWith(".gz") && !url.endsWith(".tar.gz")) {
    const binary = gunzipSync(Buffer.from(buffer));
    writeFileSync(binaryPath, binary);
    chmodSync(binaryPath, 0o755);
  } else if (url.endsWith(".tar.gz") || url.endsWith(".tar.xz") || url.endsWith(".zip")) {
    const extractDir = join(lspDir, `${info.name}-extracted`);
    if (!existsSync(extractDir)) {
      mkdirSync(extractDir, { recursive: true });
    }

    const archivePath = join(lspDir, `${info.name}-archive`);
    writeFileSync(archivePath, Buffer.from(buffer));

    try {
      if (url.endsWith(".zip")) {
        const result = Bun.spawnSync(["unzip", "-o", archivePath, "-d", extractDir], {
          timeout: 60000,
        });
        if (result.exitCode !== 0) {
          unlinkSync(archivePath);
          return { success: false, error: "Failed to extract zip archive" };
        }
      } else if (url.endsWith(".tar.xz")) {
        const result = Bun.spawnSync(["tar", "-xJf", archivePath, "-C", extractDir], {
          timeout: 60000,
        });
        if (result.exitCode !== 0) {
          unlinkSync(archivePath);
          return { success: false, error: "Failed to extract tar.xz archive" };
        }
      } else {
        const result = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir], {
          timeout: 60000,
        });
        if (result.exitCode !== 0) {
          unlinkSync(archivePath);
          return { success: false, error: "Failed to extract tar.gz archive" };
        }
      }

      unlinkSync(archivePath);

      const findBinary = Bun.spawnSync(
        ["find", extractDir, "-name", info.binaryName, "-type", "f"],
        { timeout: 30000 }
      );
      const foundPath = findBinary.stdout.toString().trim().split("\n")[0];

      if (foundPath && existsSync(foundPath)) {
        const wrapperContent = `#!/bin/bash\nexec "${foundPath}" "$@"\n`;
        writeFileSync(binaryPath, wrapperContent);
        chmodSync(binaryPath, 0o755);
        chmodSync(foundPath, 0o755);
      } else {
        return { success: false, error: `Binary '${info.binaryName}' not found in archive` };
      }
    } catch (err) {
      if (existsSync(archivePath)) unlinkSync(archivePath);
      return { success: false, error: String(err) };
    }
  } else {
    writeFileSync(binaryPath, Buffer.from(buffer));
    chmodSync(binaryPath, 0o755);
  }

  console.log(`[LSP Installer] Installed ${info.displayName} to ${binaryPath}`);
  return { success: true, path: binaryPath };
}

async function installGo(info: LSPInfo, lspDir: string): Promise<InstallResult> {
  const goCheck = Bun.spawnSync(["which", "go"]);
  if (goCheck.exitCode !== 0) {
    return { success: false, error: "Go runtime not found. Install Go first: https://go.dev/dl/" };
  }

  console.log(`[LSP Installer] Installing ${info.displayName} via go install...`);

  const result = Bun.spawnSync(["go", "install", "golang.org/x/tools/gopls@latest"], {
    env: { ...process.env, GOBIN: lspDir },
    timeout: 120000, // 2 minutes
  });

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr.toString() || "Go install failed" };
  }

  const binaryPath = join(lspDir, info.binaryName);
  console.log(`[LSP Installer] Installed ${info.displayName} to ${binaryPath}`);
  return { success: true, path: binaryPath };
}

async function installPip(info: LSPInfo, lspDir: string): Promise<InstallResult> {
  const pythonCheck = Bun.spawnSync(["which", "python3"]);
  if (pythonCheck.exitCode !== 0) {
    return { success: false, error: "Python 3 not found. Install Python first." };
  }

  console.log(`[LSP Installer] Installing ${info.displayName} via pip...`);

  const venvDir = join(lspDir, "python-venv");
  if (!existsSync(venvDir)) {
    const venvResult = Bun.spawnSync(["python3", "-m", "venv", venvDir], { timeout: 60000 });
    if (venvResult.exitCode !== 0) {
      return { success: false, error: "Failed to create Python virtual environment" };
    }
  }

  const pipPath = join(venvDir, "bin", "pip");
  const installResult = Bun.spawnSync([pipPath, "install", "python-lsp-server"], {
    timeout: 120000,
  });

  if (installResult.exitCode !== 0) {
    return { success: false, error: installResult.stderr.toString() || "Pip install failed" };
  }

  const pylspPath = join(venvDir, "bin", "pylsp");
  const wrapperPath = join(lspDir, "pylsp");

  const wrapperContent = `#!/bin/bash
exec "${pylspPath}" "$@"
`;
  writeFileSync(wrapperPath, wrapperContent);
  chmodSync(wrapperPath, 0o755);

  console.log(`[LSP Installer] Installed ${info.displayName} to ${wrapperPath}`);
  return { success: true, path: wrapperPath };
}

async function installGem(info: LSPInfo, lspDir: string): Promise<InstallResult> {
  const rubyCheck = Bun.spawnSync(["which", "gem"]);
  if (rubyCheck.exitCode !== 0) {
    return { success: false, error: "Ruby gem not found. Install Ruby first." };
  }

  console.log(`[LSP Installer] Installing ${info.displayName} via gem...`);

  const gemDir = join(lspDir, "ruby-gems");
  if (!existsSync(gemDir)) {
    mkdirSync(gemDir, { recursive: true });
  }

  const result = Bun.spawnSync(
    ["gem", "install", info.binaryName, "--install-dir", gemDir, "--bindir", lspDir],
    { timeout: 180000 }
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr.toString() || "Gem install failed" };
  }

  const binaryPath = join(lspDir, info.binaryName);
  if (existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755);
  }

  console.log(`[LSP Installer] Installed ${info.displayName} to ${binaryPath}`);
  return { success: true, path: binaryPath };
}

async function installBun(info: LSPInfo, lspDir: string): Promise<InstallResult> {
  const bunCheck = Bun.spawnSync(["which", "bun"]);
  if (bunCheck.exitCode !== 0) {
    return { success: false, error: "Bun not found in PATH" };
  }

  console.log(`[LSP Installer] Installing ${info.displayName} via bun...`);

  const packageName = info.installPackage || info.binaryName;
  const result = Bun.spawnSync(["bun", "install", "-g", packageName], {
    timeout: 120000,
  });

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr.toString() || "Bun install failed" };
  }

  const whichResult = Bun.spawnSync(["which", info.binaryName]);
  const installedPath = whichResult.stdout.toString().trim();

  if (installedPath) {
    const wrapperPath = join(lspDir, info.binaryName);
    const wrapperContent = `#!/bin/bash\nexec "${installedPath}" "$@"\n`;
    writeFileSync(wrapperPath, wrapperContent);
    chmodSync(wrapperPath, 0o755);

    console.log(`[LSP Installer] Installed ${info.displayName} to ${wrapperPath}`);
    return { success: true, path: wrapperPath };
  }

  console.log(`[LSP Installer] Installed ${info.displayName} globally`);
  return { success: true, path: "(global)" };
}

export async function uninstall(language: string): Promise<{ success: boolean; error?: string }> {
  const info = LSP_REGISTRY[language];
  if (!info) {
    return { success: false, error: `Unknown language: ${language}` };
  }

  if (info.type === "bundled") {
    return { success: false, error: "Cannot uninstall bundled language servers" };
  }

  const lspDir = getLSPDir();
  const binaryPath = join(lspDir, info.binaryName);

  try {
    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath);
      console.log(`[LSP Installer] Uninstalled ${info.displayName}`);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function getAvailableLanguages(): string[] {
  return Object.keys(LSP_REGISTRY);
}
