import { LSPClient } from "./client";
import {
  getLanguageId,
  type DefinitionResult,
  type Diagnostic,
  type Location,
  type Hover,
  type DocumentSymbolResult,
  type CompletionItem,
} from "./types";
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
  fallbackCommands?: string[];
  disabled?: boolean;
}

export interface LSPConfig {
  lsp: Record<string, LSPServerConfig>;
}

const DEFAULT_LSP_CONFIG: LSPConfig = {
  lsp: {
    typescript: {
      command: "vtsls",
      args: ["--stdio"],
      fallbackCommands: ["typescript-language-server"],
    },
    javascript: {
      command: "vtsls",
      args: ["--stdio"],
      fallbackCommands: ["typescript-language-server"],
    },
    html: {
      command: "tailwindcss-language-server",
      args: ["--stdio"],
      fallbackCommands: ["vscode-html-language-server"],
    },
    css: {
      command: "tailwindcss-language-server",
      args: ["--stdio"],
      fallbackCommands: ["vscode-css-language-server"],
    },
    json: {
      command: "vscode-json-language-server",
      args: ["--stdio"],
    },
    tailwindcss: {
      command: "tailwindcss-language-server",
      args: ["--stdio"],
    },
    eslint: {
      command: "vscode-eslint-language-server",
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
  html: "html",
  css: "css",
  scss: "css",
  json: "json",
  tailwindcss: "tailwindcss",
  python: "python",
  go: "go",
  rust: "rust",
};

const LANGUAGE_TO_SUPPLEMENTAL_CONFIGS: Record<string, string[]> = {
  typescript: ["eslint", "tailwindcss"],
  typescriptreact: ["eslint", "tailwindcss"],
  javascript: ["eslint", "tailwindcss"],
  javascriptreact: ["eslint", "tailwindcss"],
  html: ["tailwindcss"],
  css: ["tailwindcss"],
  scss: ["tailwindcss"],
};

export interface ActiveLspServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  available: boolean;
  bundled: boolean;
  primary: boolean;
  running: boolean;
  initialized: boolean;
}

type OpenDocumentState = {
  version: number;
  text: string;
  syncedAt: number;
  openedBy: Set<string>;
};

export class LSPManager {
  private clients = new Map<string, LSPClient>();
  private config: LSPConfig;
  private workspacePath: string;
  private workspaceUri: string;
  private diagnosticsCache = new Map<string, Map<string, Diagnostic[]>>();
  private openDocuments = new Map<string, OpenDocumentState>();

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
        const parsed = JSON.parse(content) as LSPConfig;
        const merged: LSPConfig = {
          lsp: { ...DEFAULT_LSP_CONFIG.lsp, ...(parsed?.lsp || {}) },
        };
        let changed = false;
        for (const [language, defaultConfig] of Object.entries(DEFAULT_LSP_CONFIG.lsp)) {
          if (!parsed?.lsp || !parsed.lsp[language]) {
            changed = true;
            merged.lsp[language] = { ...defaultConfig };
          }
        }
        if (changed) {
          writeFileSync(configPath, JSON.stringify(merged, null, 2));
        }
        return merged;
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

  private async getClientByConfigKey(configKey: string): Promise<LSPClient | null> {
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

    const commands = [serverConfig.command, ...(serverConfig.fallbackCommands || [])].filter(
      (value, index, self) => !!value && self.indexOf(value) === index
    );

    let lastError: unknown = null;
    for (const command of commands) {
      try {
        console.log(`[LSP Manager] Starting ${configKey} language server (${command})...`);
        const client = new LSPClient(command, serverConfig.args || [], this.workspaceUri);

        await client.start();
        await client.initialize();

        client.on("diagnostics", (params) => {
          const byServer = this.diagnosticsCache.get(params.uri) || new Map<string, Diagnostic[]>();
          byServer.set(configKey, params.diagnostics);
          this.diagnosticsCache.set(params.uri, byServer);
        });

        this.clients.set(configKey, client);
        console.log(`[LSP Manager] ${configKey} server ready (${command})`);
        return client;
      } catch (err) {
        lastError = err;
      }
    }
    console.error(`[LSP Manager] Failed to start ${configKey} server:`, lastError);
    return null;
  }

  private getServerKeysForLanguage(languageId: string): string[] {
    const primaryKey = LANGUAGE_TO_CONFIG[languageId];
    if (!primaryKey) return [];
    const supplemental =
      LANGUAGE_TO_SUPPLEMENTAL_CONFIGS[languageId] ||
      LANGUAGE_TO_SUPPLEMENTAL_CONFIGS[primaryKey] ||
      [];
    const ordered = [primaryKey, ...supplemental];
    return ordered.filter((key, index, self) => {
      if (!key || self.indexOf(key) !== index) return false;
      const config = this.config.lsp[key];
      return !!config && !config.disabled;
    });
  }

  private getMergedDiagnostics(uri: string): Diagnostic[] {
    const byServer = this.diagnosticsCache.get(uri);
    if (!byServer || byServer.size === 0) return [];
    const merged: Diagnostic[] = [];
    const seen = new Set<string>();
    for (const diagnostics of byServer.values()) {
      for (const diagnostic of diagnostics) {
        const key = [
          diagnostic.range?.start?.line ?? 0,
          diagnostic.range?.start?.character ?? 0,
          diagnostic.range?.end?.line ?? 0,
          diagnostic.range?.end?.character ?? 0,
          diagnostic.severity ?? 0,
          diagnostic.source || "",
          diagnostic.code || "",
          diagnostic.message || "",
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(diagnostic);
      }
    }
    return merged;
  }

  async getClient(languageId: string): Promise<LSPClient | null> {
    const configKey = LANGUAGE_TO_CONFIG[languageId];
    if (!configKey) {
      console.log(`[LSP Manager] No config for language: ${languageId}`);
      return null;
    }
    return this.getClientByConfigKey(configKey);
  }

  async getClientForFile(filePath: string): Promise<LSPClient | null> {
    const languageId = getLanguageId(filePath);
    return this.getClient(languageId);
  }

  async openDocument(filePath: string, content?: string): Promise<void> {
    const uri = `file://${filePath}`;
    const languageId = getLanguageId(filePath);
    const serverKeys = this.getServerKeysForLanguage(languageId);
    if (serverKeys.length === 0) return;
    const clients = (
      await Promise.all(
        serverKeys.map(async (key) => {
          const client = await this.getClientByConfigKey(key);
          return client ? { key, client } : null;
        })
      )
    ).filter((entry): entry is { key: string; client: LSPClient } => !!entry);
    if (clients.length === 0) return;

    const doc = this.openDocuments.get(uri);
    const now = Date.now();
    const hasMissingClient = doc ? clients.some((entry) => !doc.openedBy.has(entry.key)) : true;
    if (doc && content === undefined && now - doc.syncedAt < 1000 && !hasMissingClient) {
      return;
    }

    const text = content ?? (existsSync(filePath) ? readFileSync(filePath, "utf-8") : "");
    if (doc && doc.text === text) {
      const openedBy = new Set(doc.openedBy);
      for (const { key, client } of clients) {
        if (openedBy.has(key)) continue;
        client.didOpen({
          textDocument: {
            uri,
            languageId,
            version: doc.version,
            text,
          },
        });
        openedBy.add(key);
      }
      this.openDocuments.set(uri, { ...doc, syncedAt: now, openedBy });
      return;
    }
    const version = doc ? doc.version + 1 : 1;

    const openedBy = new Set<string>(doc?.openedBy || []);
    for (const { key, client } of clients) {
      if (openedBy.has(key)) {
        client.didChange({
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
      } else {
        client.didOpen({
          textDocument: {
            uri,
            languageId,
            version,
            text,
          },
        });
        openedBy.add(key);
      }
    }
    this.openDocuments.set(uri, { version, text, syncedAt: now, openedBy });

    await new Promise((r) => setTimeout(r, 80));
  }

  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const languageId = getLanguageId(filePath);
    const bundledDiagnostics: Diagnostic[] = [];

    if (BUNDLED_LANGUAGES.has(languageId)) {
      try {
        const bundledDiags = bundledTS.getDiagnosticsForFile(filePath);
        bundledDiagnostics.push(
          ...bundledDiags.map((d) => ({
            range: {
              start: { line: d.line - 1, character: d.column - 1 },
              end: { line: (d.endLine || d.line) - 1, character: (d.endColumn || d.column) - 1 },
            },
            severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
            message: d.message,
            source: d.source,
            code: d.code,
          }))
        );
      } catch (err) {
        console.error("[LSP Manager] Bundled TS diagnostics failed:", err);
      }
    }

    const uri = `file://${filePath}`;

    await this.openDocument(filePath);

    const lspDiagnostics = this.getMergedDiagnostics(uri);
    if (bundledDiagnostics.length === 0) {
      return lspDiagnostics;
    }
    const seen = new Set<string>();
    const merged: Diagnostic[] = [];
    for (const diagnostic of [...bundledDiagnostics, ...lspDiagnostics]) {
      const key = [
        diagnostic.range?.start?.line ?? 0,
        diagnostic.range?.start?.character ?? 0,
        diagnostic.range?.end?.line ?? 0,
        diagnostic.range?.end?.character ?? 0,
        diagnostic.severity ?? 0,
        diagnostic.source || "",
        diagnostic.code || "",
        diagnostic.message || "",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(diagnostic);
    }
    return merged;
  }

  getAllDiagnostics(): Map<string, Diagnostic[]> {
    const merged = new Map<string, Diagnostic[]>();
    for (const uri of this.diagnosticsCache.keys()) {
      merged.set(uri, this.getMergedDiagnostics(uri));
    }
    return merged;
  }

  async getDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<DefinitionResult> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getDefinitionForFile(filePath, line, character);
          return fallback.length > 0 ? fallback : null;
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS definition lookup failed:", err);
        }
      }
      return null;
    }

    await this.openDocument(filePath);

    return client.definition({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async getDeclaration(
    filePath: string,
    line: number,
    character: number
  ): Promise<DefinitionResult> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getDeclarationForFile(filePath, line, character);
          return fallback.length > 0 ? fallback : null;
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS declaration lookup failed:", err);
        }
      }
      return null;
    }

    await this.openDocument(filePath);

    return client.declaration({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async getTypeDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<DefinitionResult> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getTypeDefinitionForFile(filePath, line, character);
          return fallback.length > 0 ? fallback : null;
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS type definition lookup failed:", err);
        }
      }
      return null;
    }

    await this.openDocument(filePath);

    return client.typeDefinition({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async getImplementation(
    filePath: string,
    line: number,
    character: number
  ): Promise<DefinitionResult> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getImplementationForFile(filePath, line, character);
          return fallback.length > 0 ? fallback : null;
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS implementation lookup failed:", err);
        }
      }
      return null;
    }

    await this.openDocument(filePath);

    return client.implementation({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async getReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<Location[] | null> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getReferencesForFile(filePath, line, character);
          return fallback.length > 0 ? (fallback as unknown as Location[]) : null;
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS reference lookup failed:", err);
        }
      }
      return null;
    }

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

  async getCompletions(
    filePath: string,
    line: number,
    character: number
  ): Promise<CompletionItem[]> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          return bundledTS.getCompletionsForFile(
            filePath,
            line,
            character
          ) as unknown as CompletionItem[];
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS completion lookup failed:", err);
        }
      }
      return [];
    }

    await this.openDocument(filePath);
    const completion = await client.completion({
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });

    const items = Array.isArray(completion)
      ? completion
      : completion && Array.isArray(completion.items)
        ? completion.items
        : [];

    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.label}:${item.insertText || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async getDocumentSymbols(filePath: string): Promise<DocumentSymbolResult> {
    const languageId = getLanguageId(filePath);
    const client = await this.getClient(languageId);
    if (!client) {
      if (BUNDLED_LANGUAGES.has(languageId)) {
        try {
          const fallback = bundledTS.getDocumentSymbolsForFile(filePath);
          return fallback.length > 0 ? (fallback as unknown as DocumentSymbolResult) : [];
        } catch (err) {
          console.warn("[LSP Manager] Bundled TS symbol lookup failed:", err);
        }
      }
      return [];
    }

    await this.openDocument(filePath);
    return client.documentSymbols({
      textDocument: { uri: `file://${filePath}` },
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
      const commands = [config.command, ...(config.fallbackCommands || [])].filter(Boolean);
      for (const command of commands) {
        const result = Bun.spawnSync([checkCmd, command], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if ((result.exitCode ?? 1) === 0) return true;
      }
      return false;
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

  async getActiveServersForFile(filePath: string): Promise<{
    filePath: string;
    languageId: string;
    servers: ActiveLspServerInfo[];
  }> {
    const languageId = getLanguageId(filePath);
    const primaryKey = LANGUAGE_TO_CONFIG[languageId];
    const serverKeys = this.getServerKeysForLanguage(languageId);
    const servers: ActiveLspServerInfo[] = [];
    for (const key of serverKeys) {
      const config = this.config.lsp[key];
      if (!config || config.disabled) continue;
      const runningClient = this.clients.get(key) || null;
      servers.push({
        id: key,
        name: key,
        command: config.command,
        args: config.args || [],
        available: await this.isAvailable(key),
        bundled: this.isBundled(key),
        primary: primaryKey === key,
        running: !!runningClient,
        initialized: runningClient?.isInitialized === true,
      });
    }
    return {
      filePath,
      languageId,
      servers,
    };
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
