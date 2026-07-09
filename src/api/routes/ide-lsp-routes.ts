import { isAbsolute, resolve } from "path";
import { agentManager, type AgentMessage } from "../../core/agent";
import { trackFileOperation } from "../../core/metrics";
import { workspaceIndexer } from "../../core/workspace-indexer";
import {
  checkoutGitBranch,
  getGitBranch,
  getGitBranches,
  getGitDiff,
  getGitStatus,
} from "../git-api";
import {
  browseDirectory,
  createItem,
  getFileBlame,
  getFileHistoryUrl,
  getFilePermalink,
  listWorkspaceFiles,
  openInSystemTerminal,
  listWorkspaceOpenTargets,
  openWorkspaceTarget,
  previewReplaceInWorkspace,
  readFileContent,
  renameItem,
  replaceInWorkspace,
  revealInSystemExplorer,
  searchWorkspace,
  writeFileContent,
} from "../ide-api";
import {
  getOrInitLspManager,
  normalizeDefinitionLocation,
  normalizeLspSymbol,
  resolveWorkspacePath,
  sanitizeInlineCompletion,
  trackIdeOperation,
  trackLspOperation,
  truncateInlineContext,
} from "./lsp-ide";
import type { LspDiagnosticLike, NormalizedLspSymbol, RouteHandler } from "./_shared";

export const ideLspRoutes: Record<string, RouteHandler> = {
  "GET /api/lsp/status": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const availability: Record<string, { available: boolean; bundled: boolean }> = {};

      for (const lang of supported) {
        availability[lang] = {
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        };
      }

      trackLspOperation("status", {
        workspace: manager.getWorkspacePath(),
        supportedCount: supported.length,
        diagnosticsCount: manager.getAllDiagnostics().size,
        success: true,
      });
      return {
        status: "ok",
        workspace: process.cwd(),
        supported,
        available: availability,
        diagnosticsCount: manager.getAllDiagnostics().size,
      };
    } catch (err) {
      trackLspOperation("status", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { status: "error", error: String(err) };
    }
  },
  "GET /api/lsp/languages": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const result: Array<{ name: string; available: boolean; bundled: boolean }> = [];

      for (const lang of supported) {
        result.push({
          name: lang,
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        });
      }

      trackLspOperation("languages", {
        workspace: manager.getWorkspacePath(),
        languageCount: result.length,
        success: true,
      });
      return { languages: result };
    } catch (err) {
      trackLspOperation("languages", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { languages: [] };
    }
  },
  "GET /api/lsp/active": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("active_servers", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", servers: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    try {
      const manager = getOrInitLspManager(workspacePath);
      const active = await manager.getActiveServersForFile(normalizedPath);
      trackLspOperation("active_servers", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        languageId: active.languageId,
        serverCount: active.servers.length,
        activeCount: active.servers.filter((server) => server.available).length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        languageId: active.languageId,
        servers: active.servers,
      };
    } catch (error) {
      trackLspOperation("active_servers", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(error),
      });
      return { success: false, error: String(error), servers: [] };
    }
  },
  "GET /api/lsp/diagnostics": () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const all = manager.getAllDiagnostics();
      const result: Array<{ file: string; count: number; errors: number; warnings: number }> = [];

      for (const [uri, diags] of all) {
        const typedDiags = diags as LspDiagnosticLike[];
        result.push({
          file: uri.replace("file://", ""),
          count: typedDiags.length,
          errors: typedDiags.filter((d) => d.severity === 1).length,
          warnings: typedDiags.filter((d) => d.severity === 2).length,
        });
      }

      trackLspOperation("diagnostics", {
        workspace: manager.getWorkspacePath(),
        files: result.length,
        total: result.reduce((sum, f) => sum + f.count, 0),
        success: true,
      });
      return { files: result, total: result.reduce((sum, f) => sum + f.count, 0) };
    } catch (err) {
      trackLspOperation("diagnostics", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { files: [], total: 0 };
    }
  },
  "GET /api/lsp/diagnostics/file": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("diagnostics_file", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", diagnostics: [] };
    }
    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    try {
      const manager = getOrInitLspManager(workspacePath);
      const diagnostics = await manager.getDiagnostics(normalizedPath);
      trackLspOperation("diagnostics_file", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        diagnosticsCount: diagnostics.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        diagnostics: (diagnostics as LspDiagnosticLike[]).map((d) => ({
          line: d.range?.start?.line ?? 0,
          character: d.range?.start?.character ?? 0,
          endLine: d.range?.end?.line ?? 0,
          endCharacter: d.range?.end?.character ?? 0,
          severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
          message: d.message,
          source: d.source,
          code: d.code,
        })),
      };
    } catch (e) {
      trackLspOperation("diagnostics_file", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e), diagnostics: [] };
    }
  },
  "GET /api/lsp/definition": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("definition", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const definitions = await manager.getDefinition(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(definitions) ? definitions : definitions ? [definitions] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("definition", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("definition", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/hover": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("hover", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const hover = await manager.getHover(normalizedPath, line, character);
      let text: string | null = null;
      if (hover) {
        const contents = (hover as { contents?: unknown }).contents;
        if (typeof contents === "string") {
          text = contents;
        } else if (Array.isArray(contents)) {
          text = contents
            .map((c) => (typeof c === "string" ? c : (c as { value?: string })?.value || ""))
            .filter(Boolean)
            .join("\n\n");
        } else if (contents && typeof contents === "object") {
          text = (contents as { value?: string }).value || null;
        }
      }
      trackLspOperation("hover", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        text,
      };
    } catch (errorValue) {
      trackLspOperation("hover", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/declaration": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("declaration", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const declarations = await manager.getDeclaration(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(declarations) ? declarations : declarations ? [declarations] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("declaration", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("declaration", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/type-definition": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("type_definition", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const definitions = await manager.getTypeDefinition(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(definitions) ? definitions : definitions ? [definitions] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("type_definition", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("type_definition", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/implementation": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("implementation", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const implementations = await manager.getImplementation(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(implementations) ? implementations : implementations ? [implementations] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("implementation", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("implementation", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/references": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("references", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const references = await manager.getReferences(normalizedPath, line, character);
      const normalizedLocations = (references || [])
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      trackLspOperation("references", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("references", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/completion": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    const prefix = typeof params?.prefix === "string" ? params.prefix : "";
    const rawLimit = params?.limit as string | undefined;

    if (!filePath) {
      trackLspOperation("completion", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", items: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;
    const parsedLimit = Number.parseInt(rawLimit || "", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 80;
    const normalizedPrefix = prefix.trim().toLowerCase();

    try {
      const manager = getOrInitLspManager(workspacePath);
      const completions = await manager.getCompletions(normalizedPath, line, character);
      const filtered = completions
        .filter((item) =>
          normalizedPrefix
            ? item.label.toLowerCase().startsWith(normalizedPrefix) ||
              (item.filterText || "").toLowerCase().startsWith(normalizedPrefix)
            : true
        )
        .slice(0, limit)
        .map((item) => ({
          label: item.label,
          detail: item.detail,
          kind: item.kind,
          insertText: item.insertText || item.label,
          sortText: item.sortText,
        }));

      trackLspOperation("completion", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        count: filtered.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        items: filtered,
      };
    } catch (errorValue) {
      trackLspOperation("completion", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue), items: [] };
    }
  },
  "GET /api/lsp/symbols": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("symbols", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", symbols: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);

    try {
      const manager = getOrInitLspManager(workspacePath);
      const symbols = await manager.getDocumentSymbols(normalizedPath);
      const normalizedSymbols = (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => normalizeLspSymbol(symbol))
        .filter((symbol): symbol is NormalizedLspSymbol => !!symbol);

      trackLspOperation("symbols", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        symbolCount: normalizedSymbols.length,
        success: true,
      });

      return {
        success: true,
        path: normalizedPath,
        symbols: normalizedSymbols,
      };
    } catch (errorValue) {
      trackLspOperation("symbols", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue), symbols: [] };
    }
  },
  "GET /api/lsp/install-status": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const status = await manager.getInstallStatus();
      trackLspOperation("install_status", {
        workspace: manager.getWorkspacePath(),
        languageCount: status.length,
        success: true,
      });
      return { status };
    } catch (err) {
      trackLspOperation("install_status", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { status: [], error: String(err) };
    }
  },
  "POST /api/lsp/install": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      trackLspOperation("install", { success: false, reason: "missing_language" });
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getOrInitLspManager(process.cwd());
      const result = await manager.installLSP(language);
      trackLspOperation("install", {
        workspace: manager.getWorkspacePath(),
        language,
        success: result.success === true,
      });
      return result;
    } catch (e) {
      trackLspOperation("install", {
        workspace: process.cwd(),
        language,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e) };
    }
  },
  "POST /api/lsp/uninstall": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      trackLspOperation("uninstall", { success: false, reason: "missing_language" });
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getOrInitLspManager(process.cwd());
      const result = await manager.uninstallLSP(language);
      trackLspOperation("uninstall", {
        workspace: manager.getWorkspacePath(),
        language,
        success: result.success === true,
      });
      return result;
    } catch (e) {
      trackLspOperation("uninstall", {
        workspace: process.cwd(),
        language,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e) };
    }
  },

  "GET /api/ide/index/status": (_body, params) => {
    const workspacePathRaw = params?.workspacePath as string | undefined;
    const workspacePath =
      typeof workspacePathRaw === "string" && workspacePathRaw.trim()
        ? workspacePathRaw.trim()
        : undefined;
    const status = workspaceIndexer.getStatus();
    trackIdeOperation("index_status", workspacePath, true, {
      state: status.state,
      indexedWorkspacePath: status.indexedWorkspacePath,
      filesIndexed: status.filesIndexed,
      filesScanned: status.filesScanned,
      directoriesScanned: status.directoriesScanned,
      skippedFiles: status.skippedFiles,
      isIndexing: status.isIndexing,
      semanticReady: status.semanticReady,
      semanticProvider: status.semanticProvider || "",
      semanticModel: status.semanticModel || "",
      semanticIndexedFiles: status.semanticIndexedFiles,
      semanticIndexedChunks: status.semanticIndexedChunks,
    });
    return { success: true, ...status };
  },

  "GET /api/ide/index/embeddings": async () => {
    try {
      const catalog = await workspaceIndexer.getEmbeddingCatalog();
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embeddings", status.workspacePath || undefined, true, {
        selectedProvider: catalog.selected.provider,
        selectedModel: catalog.selected.model || "",
      });
      return {
        success: true,
        ...catalog,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embeddings", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/index/embedding/runtime": (_body, params) => {
    try {
      const provider =
        typeof (params?.provider as string | undefined) === "string"
          ? ((params?.provider as string | undefined) || "").trim()
          : "";
      const model =
        typeof (params?.model as string | undefined) === "string"
          ? ((params?.model as string | undefined) || "").trim()
          : "";
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: provider || undefined,
        model: model || undefined,
      });
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embedding_runtime", status.workspacePath || undefined, true, {
        selectedProvider: runtime.selectedProvider,
        selectedModel: runtime.selectedModel,
        vectorProvider: runtime.vectorProvider,
        vectorModel: runtime.vectorModel,
        transformerSelectedModel: runtime.transformers.selectedModel,
        transformerSelectedState: runtime.transformers.selectedState,
        transformerLoadedCount: runtime.transformers.loadedModels.length,
      });
      return {
        success: true,
        ...runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_runtime", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/workspace": async (body) => {
    const data = body as { workspacePath?: string };
    if (!data?.workspacePath || typeof data.workspacePath !== "string") {
      trackIdeOperation("index_workspace", undefined, false, { reason: "missing_workspace_path" });
      return { success: false, error: "Missing 'workspacePath' parameter" };
    }
    try {
      const status = workspaceIndexer.setWorkspaceInBackground(data.workspacePath);
      trackIdeOperation("index_workspace", data.workspacePath, true, {
        state: status.state,
        filesIndexed: status.filesIndexed,
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_workspace", data.workspacePath, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/reindex": async (body) => {
    const data = body as { workspacePath?: string };
    try {
      const status = workspaceIndexer.reindexInBackground(
        typeof data?.workspacePath === "string" && data.workspacePath.trim()
          ? data.workspacePath
          : undefined
      );
      trackIdeOperation("index_reindex", data?.workspacePath, true, {
        state: status.state,
        filesIndexed: status.filesIndexed,
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_reindex", data?.workspacePath, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/stop": () => {
    const status = workspaceIndexer.stop();
    trackIdeOperation("index_stop", status.workspacePath || undefined, true, {
      state: status.state,
    });
    return { success: true, ...status };
  },

  "PUT /api/ide/index/settings": (body) => {
    try {
      const settings = workspaceIndexer.updateSettings(body);
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_settings", status.workspacePath || undefined, true, {
        enabled: settings.enabled,
        autoReindexOnWorkspaceSet: settings.autoReindexOnWorkspaceSet,
        includeHidden: settings.includeHidden,
        maxFiles: settings.maxFiles,
        maxFileSizeBytes: settings.maxFileSizeBytes,
        semanticEnabled: settings.semanticEnabled,
        semanticMaxFiles: settings.semanticMaxFiles,
        semanticMinScore: settings.semanticMinScore,
        embeddingProvider: settings.embeddingProvider,
        embeddingModel: settings.embeddingModel || "",
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_settings", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/embedding/load": async (body) => {
    const data = (body || {}) as { provider?: string; model?: string };
    try {
      const result = await workspaceIndexer.loadEmbeddingRuntime({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      const status = workspaceIndexer.getStatus();
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      trackIdeOperation("index_embedding_load", status.workspacePath || undefined, result.success, {
        provider: result.provider,
        model: result.model,
      });
      return {
        ...result,
        status,
        runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_load", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/embedding/stop": async (body) => {
    const data = (body || {}) as { provider?: string; model?: string };
    try {
      const result = await workspaceIndexer.stopEmbeddingRuntime({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embedding_stop", status.workspacePath || undefined, result.success, {
        provider: result.provider,
        model: result.model,
      });
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      return {
        ...result,
        status,
        runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_stop", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/index/search": async (_body, params) => {
    const path =
      typeof (params?.path as string | undefined) === "string"
        ? (params?.path as string | undefined) || "~"
        : "~";
    const query = (params?.query as string | undefined) || "";
    const parsedLimit = Number.parseInt((params?.limit as string | undefined) || "", 10);
    const parsedMaxFilesScanned = Number.parseInt(
      (params?.maxFilesScanned as string | undefined) || "",
      10
    );
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const maxFilesScanned = Number.isFinite(parsedMaxFilesScanned)
      ? parsedMaxFilesScanned
      : undefined;
    const indexedResult = await workspaceIndexer.search(query, {
      workspacePath: path,
      limit,
    });

    if (indexedResult.success) {
      trackIdeOperation("index_search", path, true, {
        source: "index",
        queryLength: query.length,
        totalFiles: indexedResult.totalFiles,
        truncated: indexedResult.truncated,
        semanticMatches: indexedResult.semanticMatches || 0,
      });
      return indexedResult;
    }

    const fallback = await listWorkspaceFiles(path, { query, limit, maxFilesScanned });
    const success = fallback.success !== false;
    trackIdeOperation("index_search", path, success, {
      source: "filesystem",
      queryLength: query.length,
      totalFiles: fallback.totalFiles,
      truncated: fallback.truncated,
      filesScanned: fallback.filesScanned,
      scanTruncated: fallback.scanTruncated,
      indexError: indexedResult.error,
      indexState: indexedResult.indexState,
    });
    return {
      ...fallback,
      source: "filesystem",
      indexed: false,
      indexState: indexedResult.indexState,
      indexError: indexedResult.error,
      workspacePath: path,
    };
  },

  "POST /api/ide/inline-completion": async (body) => {
    const data = body as {
      path?: string;
      before?: string;
      after?: string;
      prefix?: string;
      suffix?: string;
      agentId?: string;
      workspacePath?: string;
      maxChars?: number;
    };

    const path = typeof data.path === "string" ? data.path.trim() : "";
    const before = typeof data.before === "string" ? data.before : "";
    const after = typeof data.after === "string" ? data.after : "";
    const prefix = typeof data.prefix === "string" ? data.prefix : "";
    const suffix = typeof data.suffix === "string" ? data.suffix : "";
    const requestedMaxChars = Number.isFinite(Number(data.maxChars)) ? Number(data.maxChars) : 320;
    const maxChars = Math.max(40, Math.min(2000, Math.floor(requestedMaxChars)));

    if (!path) {
      trackIdeOperation("inline_completion", path || undefined, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const requestedAgentId =
      typeof data.agentId === "string" && data.agentId.trim() ? data.agentId.trim() : "";
    const selectedAgent =
      (requestedAgentId ? agentManager.get(requestedAgentId) : undefined) ||
      agentManager.list().find((agent) => agent.status === "running") ||
      agentManager.list()[0];

    if (!selectedAgent) {
      trackIdeOperation("inline_completion", path, false, { reason: "no_agent_available" });
      return { success: false, error: "No available agent for inline completion" };
    }

    const provider = agentManager.resolveProvider(selectedAgent.id);
    if (!provider) {
      trackIdeOperation("inline_completion", path, false, {
        reason: "provider_unavailable",
        agentId: selectedAgent.id,
      });
      return { success: false, error: "Selected agent has no configured provider" };
    }

    const workspaceDirRaw =
      typeof data.workspacePath === "string" && data.workspacePath.trim()
        ? data.workspacePath.trim()
        : resolveWorkspacePath(path);
    const workspaceDir = workspaceDirRaw || undefined;
    const beforeContext = truncateInlineContext(before, 5000);
    const afterContext = (after || "").slice(0, 1800);
    const suffixContext = suffix.slice(0, 320);

    try {
      const messages: AgentMessage[] = [
        {
          role: "system",
          content: [
            "You are an IDE inline code completion engine.",
            "Return only the exact continuation text to insert at the cursor.",
            "Do not return markdown, backticks, labels, or explanations.",
            "Do not repeat code already present before the cursor.",
            "Prefer concise completions and keep style consistent with surrounding code.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `File: ${path}`,
            prefix ? `Already typed prefix: ${prefix}` : "Already typed prefix: (none)",
            suffixContext
              ? `Existing suffix hint: ${suffixContext}`
              : "Existing suffix hint: (none)",
            "",
            "Code before cursor:",
            beforeContext || "(empty)",
            "",
            "Code after cursor:",
            afterContext || "(empty)",
            "",
            "Return only the completion text now.",
          ].join("\n"),
        },
      ];

      const result = await agentManager.callLLM(provider, selectedAgent.model, messages, [], {
        agentId: selectedAgent.id,
        workspaceDir,
        suppressStreaming: true,
      });
      const completion = sanitizeInlineCompletion(result.content || "", prefix, maxChars);

      trackIdeOperation("inline_completion", path, true, {
        agentId: selectedAgent.id,
        providerId: provider.id,
        model: selectedAgent.model || "",
        completionLength: completion.length,
      });
      return {
        success: true,
        completion,
        agentId: selectedAgent.id,
        model: selectedAgent.model,
        provider: provider.provider,
      };
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      trackIdeOperation("inline_completion", path, false, {
        agentId: selectedAgent.id,
        error: message,
      });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/browse": async (_body, params) => {
    const path = params?.path as string | undefined;
    const result = await browseDirectory(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("browse", path, success);
    trackFileOperation("search", path || process.cwd(), { success });
    return result;
  },

  "GET /api/ide/read": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("read", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await readFileContent(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("read", path, success);
    trackFileOperation("read", path, { success });
    return result;
  },

  "GET /api/ide/blame": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("blame", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const parsedMaxLines = Number.parseInt((params?.maxLines as string | undefined) || "", 10);
    const maxLines = Number.isFinite(parsedMaxLines) ? parsedMaxLines : undefined;
    const result = await getFileBlame(path, { maxLines });
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("blame", path, success, {
      lines: Array.isArray((result as { lines?: unknown }).lines)
        ? ((result as { lines: unknown[] }).lines || []).length
        : 0,
      truncated: (result as { truncated?: boolean }).truncated === true,
    });
    trackFileOperation("search", path, { success, operation: "blame" });
    return result;
  },

  "POST /api/ide/reveal": async (body) => {
    const { path } = body as { path?: string };
    if (!path || typeof path !== "string") {
      trackIdeOperation("reveal", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await revealInSystemExplorer(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("reveal", path, success);
    return result;
  },
  "POST /api/ide/open-terminal": async (body) => {
    const { path } = body as { path?: string };
    if (!path || typeof path !== "string") {
      trackIdeOperation("open_terminal", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await openInSystemTerminal(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("open_terminal", path, success);
    return result;
  },
  "GET /api/ide/open-targets": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path || typeof path !== "string") {
      trackIdeOperation("open_targets", path, false, { reason: "missing_path" });
      return { success: false, path: path || "", targets: [], error: "Missing 'path' parameter" };
    }
    const result = await listWorkspaceOpenTargets(path);
    trackIdeOperation("open_targets", path, result.success !== false, {
      count: result.targets.length,
    });
    return result;
  },
  "POST /api/ide/open": async (body) => {
    const { path, targetId } = body as { path?: string; targetId?: string };
    if (!path || typeof path !== "string") {
      trackIdeOperation("open_workspace", path, false, { reason: "missing_path" });
      return { success: false, path: path || "", error: "Missing 'path' parameter" };
    }
    if (!targetId || typeof targetId !== "string") {
      trackIdeOperation("open_workspace", path, false, { reason: "missing_target" });
      return { success: false, path, error: "Missing 'targetId' parameter" };
    }
    const result = await openWorkspaceTarget(path, targetId);
    trackIdeOperation("open_workspace", path, result.success !== false, { targetId });
    return result;
  },
  "GET /api/ide/permalink": async (_body, params) => {
    const path = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    if (!path) {
      trackIdeOperation("permalink", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 1) : 1;
    const result = await getFilePermalink(path, line);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("permalink", path, success, { line });
    return result;
  },
  "GET /api/ide/history-url": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("history_url", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await getFileHistoryUrl(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("history_url", path, success);
    return result;
  },

  "POST /api/ide/write": async (body) => {
    const { path, content } = body as { path?: string; content?: string };
    if (!path) {
      trackIdeOperation("write", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (content === undefined) {
      trackIdeOperation("write", path, false, { reason: "missing_content" });
      return { success: false, error: "Missing 'content' parameter" };
    }
    const result = await writeFileContent(path, content);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("write", path, success, { bytes: content.length });
    trackFileOperation("write", path, { success, bytes: content.length });
    return result;
  },

  "POST /api/ide/create": async (body) => {
    const { parentPath, name, type } = body as {
      parentPath?: string;
      name?: string;
      type?: "file" | "directory";
    };
    if (!parentPath) {
      trackIdeOperation("create", parentPath, false, { reason: "missing_parent_path" });
      return { success: false, error: "Missing 'parentPath' parameter" };
    }
    if (!name) {
      trackIdeOperation("create", parentPath, false, { reason: "missing_name" });
      return { success: false, error: "Missing 'name' parameter" };
    }
    if (!type || (type !== "file" && type !== "directory")) {
      trackIdeOperation("create", parentPath, false, { reason: "invalid_type" });
      return {
        success: false,
        error: "Missing or invalid 'type' parameter (must be 'file' or 'directory')",
      };
    }
    const createdPath = resolve(parentPath, name);
    const result = await createItem(parentPath, name, type);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("create", createdPath, success, { type });
    trackFileOperation("write", createdPath, { success, type, parentPath });
    return result;
  },

  "POST /api/ide/rename": async (body) => {
    const { path, newName } = body as {
      path?: string;
      newName?: string;
    };
    if (!path) {
      trackIdeOperation("rename", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (!newName || typeof newName !== "string") {
      trackIdeOperation("rename", path, false, { reason: "missing_new_name" });
      return { success: false, error: "Missing 'newName' parameter" };
    }
    const result = await renameItem(path, newName);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("rename", path, success, { newName });
    trackFileOperation("write", path, { success, operation: "rename", newName });
    return result;
  },

  "GET /api/ide/search": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const query = (params?.query as string | undefined) || "";
    const caseSensitive = params?.caseSensitive === "true";
    const wholeWord = params?.wholeWord === "true";
    const parsedMaxResults = Number.parseInt((params?.maxResults as string | undefined) || "", 10);
    const parsedMaxFilesScanned = Number.parseInt(
      (params?.maxFilesScanned as string | undefined) || "",
      10
    );
    const result = await searchWorkspace(path, query, {
      caseSensitive,
      wholeWord,
      maxResults: Number.isFinite(parsedMaxResults) ? parsedMaxResults : undefined,
      maxFilesScanned: Number.isFinite(parsedMaxFilesScanned) ? parsedMaxFilesScanned : undefined,
    });
    const success = result.success !== false;
    trackIdeOperation("search", path, success, {
      queryLength: query.length,
      totalMatches: result.totalMatches,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    trackFileOperation("search", path || process.cwd(), {
      success,
      queryLength: query.length,
      totalMatches: result.totalMatches,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    return result;
  },

  "GET /api/ide/files": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const query = (params?.query as string | undefined) || "";
    const parsedLimit = Number.parseInt((params?.limit as string | undefined) || "", 10);
    const parsedMaxFilesScanned = Number.parseInt(
      (params?.maxFilesScanned as string | undefined) || "",
      10
    );
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const result = await listWorkspaceFiles(path, {
      query,
      limit,
      maxFilesScanned: Number.isFinite(parsedMaxFilesScanned) ? parsedMaxFilesScanned : undefined,
    });
    const success = result.success !== false;
    trackIdeOperation("list_files", path, success, {
      queryLength: query.length,
      totalFiles: result.totalFiles,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    trackFileOperation("search", path || process.cwd(), {
      success,
      queryLength: query.length,
      totalFiles: result.totalFiles,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    return result;
  },

  "POST /api/ide/replace": async (body) => {
    const { path, query, replacement, caseSensitive, wholeWord, files, maxFilesScanned } = body as {
      path?: string;
      query?: string;
      replacement?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      files?: string[];
      maxFilesScanned?: number;
    };
    if (!query || typeof query !== "string") {
      return { success: false, error: "Missing 'query' parameter" };
    }
    if (typeof replacement !== "string") {
      return { success: false, error: "Missing 'replacement' parameter" };
    }

    const targetPath = path || "~";
    const result = await replaceInWorkspace(targetPath, query, replacement, {
      caseSensitive: caseSensitive === true,
      wholeWord: wholeWord === true,
      files: Array.isArray(files) ? files : undefined,
      maxFilesScanned: Number.isFinite(maxFilesScanned) ? maxFilesScanned : undefined,
    });

    const success = result.success !== false;
    trackIdeOperation("replace", targetPath, success, {
      queryLength: query.length,
      replacementLength: replacement.length,
      changedFiles: result.changedFiles.length,
      totalReplacements: result.totalReplacements,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    trackFileOperation("write", targetPath || process.cwd(), {
      success,
      queryLength: query.length,
      totalReplacements: result.totalReplacements,
      changedFiles: result.changedFiles.length,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });

    return result;
  },

  "POST /api/ide/replace/preview": async (body) => {
    const { path, query, replacement, caseSensitive, wholeWord, files, maxFiles, maxFilesScanned } =
      body as {
        path?: string;
        query?: string;
        replacement?: string;
        caseSensitive?: boolean;
        wholeWord?: boolean;
        files?: string[];
        maxFiles?: number;
        maxFilesScanned?: number;
      };
    if (!query || typeof query !== "string") {
      return { success: false, error: "Missing 'query' parameter" };
    }
    if (typeof replacement !== "string") {
      return { success: false, error: "Missing 'replacement' parameter" };
    }

    const targetPath = path || "~";
    const result = await previewReplaceInWorkspace(targetPath, query, replacement, {
      caseSensitive: caseSensitive === true,
      wholeWord: wholeWord === true,
      files: Array.isArray(files) ? files : undefined,
      maxFiles: Number.isFinite(maxFiles) ? maxFiles : undefined,
      maxFilesScanned: Number.isFinite(maxFilesScanned) ? maxFilesScanned : undefined,
    });

    const success = result.success !== false;
    trackIdeOperation("replace_preview", targetPath, success, {
      queryLength: query.length,
      replacementLength: replacement.length,
      files: result.files.length,
      totalReplacements: result.totalReplacements,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });
    trackFileOperation("search", targetPath || process.cwd(), {
      success,
      queryLength: query.length,
      totalReplacements: result.totalReplacements,
      files: result.files.length,
      truncated: result.truncated,
      filesScanned: result.filesScanned,
      scanTruncated: result.scanTruncated,
    });

    return result;
  },

  "GET /api/git/status": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    return await getGitStatus(path);
  },

  "GET /api/git/branch": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const branch = await getGitBranch(path);
    return { branch };
  },

  "GET /api/git/branches": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    return await getGitBranches(path);
  },

  "POST /api/git/branch": async (body) => {
    const { path, branch, create } = (body || {}) as {
      path?: string;
      branch?: string;
      create?: boolean;
    };
    if (!path || typeof path !== "string") {
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (!branch || typeof branch !== "string") {
      return { success: false, error: "Missing 'branch' parameter" };
    }
    return await checkoutGitBranch(path, branch, { create: create === true });
  },

  "GET /api/git/diff": async (_body, params) => {
    const path = params?.path as string | undefined;
    const staged = params?.staged === "true";
    if (!path) {
      return { success: false, error: "Missing 'path' parameter" };
    }
    return await getGitDiff(path, staged);
  },
};
