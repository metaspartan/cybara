// LSP Manager
// Manages multiple language server clients and provides unified access

import { exec } from "child_process";
import { LSPClient } from "./client";
import { getLanguageId, type Diagnostic, type Location, type Hover } from "./types";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { cybaraDir } from "../paths";
import * as bundledTS from "./bundled-ts";
import * as installer from "./installer";

// Languages with bundled support (no external install needed)
const BUNDLED_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
]);

// Language server configurations
export interface LSPServerConfig {
  command: string;
  args?: string[];
  disabled?: boolean;
}

export interface LSPConfig {
  lsp: Record<string, LSPServerConfig>;
}

// Default language server configurations
const DEFAULT_LSP_CONFIG: LSPConfig = {
  lsp: {
    typescript: {
      command: "typescript-language-server",
      args: ["--stdio"],
    },
    javascript: {
      command: "typescript-language-server",
      args: ["--stdio"],
    },
    python: {
      command: "pylsp",
    },
    go: {
      command: "gopls",
    },
    rust: {
      command: "rust-analyzer",
    },
  },
};

// Map language IDs to config keys
const LANGUAGE_TO_CONFIG: Record<string, string> = {
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "javascript",
  javascriptreact: "javascript",
  python: "python",
  go: "go",
  rust: "rust",
};

export class LSPManager {
  private clients = new Map<string, LSPClient>();
  private config: LSPConfig;
  private workspaceUri: string;
  private diagnosticsCache = new Map<string, Diagnostic[]>();
  private openDocuments = new Map<string, { version: number; text: string }>();

  constructor(workspacePath: string) {
    this.workspaceUri = `file://${workspacePath}`;
    this.config = this.loadConfig();
  }

  private loadConfig(): LSPConfig {
    const configPath = join(cybaraDir, "lsp.json");

    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        return JSON.parse(content) as LSPConfig;
      } catch (err) {
        console.warn("[LSP Manager] Failed to load config, using defaults:", err);
      }
    } else {
      // Create default config
      try {
        writeFileSync(configPath, JSON.stringify(DEFAULT_LSP_CONFIG, null, 2));
        console.log("[LSP Manager] Created default config at", configPath);
      } catch {
        // Ignore write errors
      }
    }

    return DEFAULT_LSP_CONFIG;
  }

  async getClient(languageId: string): Promise<LSPClient | null> {
    const configKey = LANGUAGE_TO_CONFIG[languageId];
    if (!configKey) {
      console.log(`[LSP Manager] No config for language: ${languageId}`);
      return null;
    }

    const serverConfig = this.config.lsp[configKey];
    if (!serverConfig || serverConfig.disabled) {
      return null;
    }

    // Check if client already exists
    if (this.clients.has(configKey)) {
      const client = this.clients.get(configKey)!;
      if (client.isInitialized) {
        return client;
      }
    }

    // Create new client
    try {
      console.log(`[LSP Manager] Starting ${configKey} language server...`);
      const client = new LSPClient(
        serverConfig.command,
        serverConfig.args || [],
        this.workspaceUri
      );

      await client.start();
      await client.initialize();

      // Listen for diagnostics
      client.on("diagnostics", (params) => {
        this.diagnosticsCache.set(params.uri, params.diagnostics);
      });

      this.clients.set(configKey, client);
      console.log(`[LSP Manager] ${configKey} server ready`);
      return client;
    } catch (err) {
      console.error(`[LSP Manager] Failed to start ${configKey} server:`, err);
      return null;
    }
  }

  async getClientForFile(filePath: string): Promise<LSPClient | null> {
    const languageId = getLanguageId(filePath);
    return this.getClient(languageId);
  }

  // Open a document in the language server
  async openDocument(filePath: string, content?: string): Promise<void> {
    const client = await this.getClientForFile(filePath);
    if (!client) return;

    const uri = `file://${filePath}`;
    const languageId = getLanguageId(filePath);
    const text = content || (existsSync(filePath) ? readFileSync(filePath, "utf-8") : "");

    const doc = this.openDocuments.get(uri);
    const version = doc ? doc.version + 1 : 1;

    this.openDocuments.set(uri, { version, text });

    if (!doc) {
      // First time opening
      client.didOpen({
        textDocument: {
          uri,
          languageId,
          version,
          text,
        },
      });
    } else {
      // Document already open, send change
      client.didChange({
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }

    // Wait a moment for diagnostics
    await new Promise((r) => setTimeout(r, 500));
  }

  // Get diagnostics for a file
  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const languageId = getLanguageId(filePath);

    // Use bundled TypeScript for TS/JS files
    if (BUNDLED_LANGUAGES.has(languageId)) {
      try {
        const bundledDiags = bundledTS.getDiagnosticsForFile(filePath);
        // Convert bundled format to LSP format
        return bundledDiags.map((d) => ({
          range: {
            start: { line: d.line - 1, character: d.column - 1 },
            end: { line: (d.endLine || d.line) - 1, character: (d.endColumn || d.column) - 1 },
          },
          severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
          message: d.message,
          source: d.source,
          code: d.code,
        }));
      } catch (err) {
        console.error("[LSP Manager] Bundled TS diagnostics failed:", err);
        // Fall through to external LSP
      }
    }

    const uri = `file://${filePath}`;

    // Ensure document is open
    await this.openDocument(filePath);

    return this.diagnosticsCache.get(uri) || [];
  }

  // Get all diagnostics across workspace
  getAllDiagnostics(): Map<string, Diagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

  // Go to definition
  async getDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<Location | Location[] | null> {
    const client = await this.getClientForFile(filePath);
    if (!client) return null;

    await this.openDocument(filePath);

    return client.definition({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  // Find references
  async getReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<Location[] | null> {
    const client = await this.getClientForFile(filePath);
    if (!client) return null;

    await this.openDocument(filePath);

    return client.references({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  // Get hover info
  async getHover(filePath: string, line: number, character: number): Promise<Hover | null> {
    const client = await this.getClientForFile(filePath);
    if (!client) return null;

    await this.openDocument(filePath);

    return client.hover({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  // Get supported languages
  getSupportedLanguages(): string[] {
    return Object.keys(this.config.lsp).filter((lang) => !this.config.lsp[lang].disabled);
  }

  // Check if a language server is available
  async isAvailable(language: string): Promise<boolean> {
    // Bundled languages are always available
    if (BUNDLED_LANGUAGES.has(language)) {
      return true;
    }

    // Check if installed locally via installer
    if (installer.isInstalled(language)) {
      return true;
    }

    const config = this.config.lsp[language];
    if (!config || config.disabled) return false;

    // Try to find the command in PATH (use 'where' on Windows)
    try {
      return new Promise((resolve) => {
        const checkCmd = process.platform === "win32" ? "where" : "which";
        exec(`${checkCmd} ${config.command}`, (error) => {
          resolve(!error);
        });
      });
    } catch {
      return false;
    }
  }

  // Check if a language uses bundled support
  isBundled(language: string): boolean {
    return BUNDLED_LANGUAGES.has(language);
  }

  // Check if LSP is installed locally (in ~/.cybara/lsp/)
  isInstalledLocally(language: string): boolean {
    return installer.isInstalled(language);
  }

  // Get installation status for all languages
  async getInstallStatus() {
    return installer.getInstallStatus();
  }

  // Install LSP for a language
  async installLSP(language: string) {
    return installer.install(language);
  }

  // Uninstall LSP for a language
  async uninstallLSP(language: string) {
    return installer.uninstall(language);
  }

  // Shutdown all clients
  async shutdown(): Promise<void> {
    for (const [name, client] of this.clients) {
      console.log(`[LSP Manager] Shutting down ${name}...`);
      await client.shutdown();
    }
    this.clients.clear();
    this.diagnosticsCache.clear();
    this.openDocuments.clear();
  }
}

// Singleton instance
let manager: LSPManager | null = null;

export function getLSPManager(workspacePath?: string): LSPManager {
  if (!manager && workspacePath) {
    manager = new LSPManager(workspacePath);
  }
  if (!manager) {
    throw new Error("LSP Manager not initialized - provide workspace path");
  }
  return manager;
}

export function initLSPManager(workspacePath: string): LSPManager {
  if (manager) {
    manager.shutdown();
  }
  manager = new LSPManager(workspacePath);
  return manager;
}
