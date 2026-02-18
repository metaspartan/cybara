import { LSPClient } from "./client";
import { getLanguageId, type Diagnostic, type Location, type Hover } from "./types";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cybaraDir } from "../paths";
import * as bundledTS from "./bundled-ts";
import * as installer from "./installer";

const BUNDLED_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
]);

export interface LSPServerConfig {
  command: string;
  args?: string[];
  disabled?: boolean;
}

export interface LSPConfig {
  lsp: Record<string, LSPServerConfig>;
}

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
  private workspacePath: string;
  private workspaceUri: string;
  private diagnosticsCache = new Map<string, Diagnostic[]>();
  private openDocuments = new Map<string, { version: number; text: string }>();

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
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

    if (this.clients.has(configKey)) {
      const client = this.clients.get(configKey)!;
      if (client.isInitialized) {
        return client;
      }
    }

    try {
      console.log(`[LSP Manager] Starting ${configKey} language server...`);
      const client = new LSPClient(
        serverConfig.command,
        serverConfig.args || [],
        this.workspaceUri
      );

      await client.start();
      await client.initialize();

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
      client.didOpen({
        textDocument: {
          uri,
          languageId,
          version,
          text,
        },
      });
    } else {
      client.didChange({
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const languageId = getLanguageId(filePath);

    if (BUNDLED_LANGUAGES.has(languageId)) {
      try {
        const bundledDiags = bundledTS.getDiagnosticsForFile(filePath);
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
      }
    }

    const uri = `file://${filePath}`;

    await this.openDocument(filePath);

    return this.diagnosticsCache.get(uri) || [];
  }

  getAllDiagnostics(): Map<string, Diagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

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

  async getHover(filePath: string, line: number, character: number): Promise<Hover | null> {
    const client = await this.getClientForFile(filePath);
    if (!client) return null;

    await this.openDocument(filePath);

    return client.hover({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  getSupportedLanguages(): string[] {
    return Object.keys(this.config.lsp).filter((lang) => !this.config.lsp[lang].disabled);
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  async isAvailable(language: string): Promise<boolean> {
    if (BUNDLED_LANGUAGES.has(language)) {
      return true;
    }

    if (installer.isInstalled(language)) {
      return true;
    }

    const config = this.config.lsp[language];
    if (!config || config.disabled) return false;

    try {
      const checkCmd = process.platform === "win32" ? "where" : "which";
      const result = Bun.spawnSync([checkCmd, config.command], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return (result.exitCode ?? 1) === 0;
    } catch {
      return false;
    }
  }

  isBundled(language: string): boolean {
    return BUNDLED_LANGUAGES.has(language);
  }

  isInstalledLocally(language: string): boolean {
    return installer.isInstalled(language);
  }

  async getInstallStatus() {
    return installer.getInstallStatus();
  }

  async installLSP(language: string) {
    return installer.install(language);
  }

  async uninstallLSP(language: string) {
    return installer.uninstall(language);
  }

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
