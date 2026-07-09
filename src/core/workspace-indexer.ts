import { readdir, readFile, stat } from "fs/promises";
import { existsSync, realpathSync, statSync } from "fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { config, type WorkspaceIndexerSettings } from "./config";
import { createLogger } from "./logger";
import { getEmbeddingProviderCatalog, type EmbeddingProviderPreference } from "./memory/embeddings";
import { getVectorStore } from "./memory/vector-store";

type WorkspaceIndexerState = "idle" | "indexing" | "ready" | "stopped" | "error";

interface IndexedFileRecord {
  path: string;
  relativePath: string;
  relativePathLower: string;
  baseNameLower: string;
  sizeBytes: number;
}

export interface WorkspaceIndexerStatus {
  state: WorkspaceIndexerState;
  isIndexing: boolean;
  workspacePath: string | null;
  indexedWorkspacePath: string | null;
  filesIndexed: number;
  filesScanned: number;
  directoriesScanned: number;
  skippedFiles: number;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastIndexedAt: string | null;
  semanticReady: boolean;
  semanticProvider: string | null;
  semanticModel: string | null;
  semanticIndexedFiles: number;
  semanticIndexedChunks: number;
  semanticError: string | null;
  error: string | null;
  settings: WorkspaceIndexerSettings;
}

export interface WorkspaceIndexerSearchResult {
  success: boolean;
  source: "index";
  indexed: boolean;
  indexState: WorkspaceIndexerState;
  path: string;
  workspacePath: string | null;
  query: string;
  totalFiles: number;
  truncated: boolean;
  semanticMatches: number;
  files: Array<{ path: string; relativePath: string }>;
  error?: string;
}

const log = createLogger("WorkspaceIndexer");

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".webm",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".wasm",
  ".jar",
  ".bin",
  ".class",
]);

const HOME_DIR = homedir();
const HOME_ROOTS = Array.from(new Set([resolve(HOME_DIR), resolveCanonicalPath(HOME_DIR)]));
const STATUS_UPDATE_INTERVAL = 200;
const SEMANTIC_WORKSPACE_MAX_FILE_SIZE_BYTES = 256 * 1024;
const SEMANTIC_WORKSPACE_EMBEDDING_BATCH_SIZE = 24;
const SEMANTIC_WORKSPACE_EMBEDDING_CONCURRENCY = 1;
const HARD_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".build",
  ".research",
  ".cache",
  ".gradle",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".expo",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  "__pycache__",
]);
const HARD_IGNORE_FILES = new Set([".ds_store", "thumbs.db"]);

function resolveCanonicalPath(pathValue: string): string {
  try {
    return realpathSync(pathValue);
  } catch {
    return resolve(pathValue);
  }
}

function isWithinRoot(rootPath: string, resolvedPath: string): boolean {
  const rel = relative(rootPath, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isWithinHome(resolvedPath: string): boolean {
  return HOME_ROOTS.some((rootPath) => isWithinRoot(rootPath, resolvedPath));
}

function isHomeRootPath(resolvedPath: string): boolean {
  const canonicalPath = resolveCanonicalPath(resolvedPath);
  return HOME_ROOTS.some((rootPath) => resolve(rootPath) === resolve(canonicalPath));
}

function expandHomePath(pathValue: string): string {
  if (pathValue.startsWith("~")) {
    return join(HOME_DIR, pathValue.slice(1));
  }
  return pathValue;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function scoreIndexedFile(relativePath: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedPath = relativePath.toLowerCase();
  const fileName = normalizedPath.split("/").pop() || normalizedPath;

  if (fileName === normalizedQuery) return 0;
  if (fileName.startsWith(normalizedQuery)) return 1;
  const fileNameIndex = fileName.indexOf(normalizedQuery);
  if (fileNameIndex >= 0) return 2 + fileNameIndex / 1000;
  if (normalizedPath.includes(`/${normalizedQuery}`)) return 3;
  const pathIndex = normalizedPath.indexOf(normalizedQuery);
  if (pathIndex >= 0) return 4 + pathIndex / 10000;
  return 10;
}

class WorkspaceIndexer {
  private state: WorkspaceIndexerState = "idle";
  private activeToken: number | null = null;
  private runSequence = 0;
  private workspacePath: string | null = null;
  private indexedWorkspacePath: string | null = null;
  private indexedFiles: IndexedFileRecord[] = [];
  private filesIndexed = 0;
  private filesScanned = 0;
  private directoriesScanned = 0;
  private skippedFiles = 0;
  private progress = 0;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private durationMs: number | null = null;
  private lastIndexedAt: string | null = null;
  private semanticReady = false;
  private semanticProvider: string | null = null;
  private semanticModel: string | null = null;
  private semanticIndexedFiles = 0;
  private semanticIndexedChunks = 0;
  private semanticError: string | null = null;
  private error: string | null = null;

  getStatus(): WorkspaceIndexerStatus {
    return {
      state: this.state,
      isIndexing: this.state === "indexing",
      workspacePath: this.workspacePath,
      indexedWorkspacePath: this.indexedWorkspacePath,
      filesIndexed: this.filesIndexed,
      filesScanned: this.filesScanned,
      directoriesScanned: this.directoriesScanned,
      skippedFiles: this.skippedFiles,
      progress: this.progress,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: this.durationMs,
      lastIndexedAt: this.lastIndexedAt,
      semanticReady: this.semanticReady,
      semanticProvider: this.semanticProvider,
      semanticModel: this.semanticModel,
      semanticIndexedFiles: this.semanticIndexedFiles,
      semanticIndexedChunks: this.semanticIndexedChunks,
      semanticError: this.semanticError,
      error: this.error,
      settings: config.getWorkspaceIndexerSettings(),
    };
  }

  updateSettings(nextSettings: unknown): WorkspaceIndexerSettings {
    const previous = config.getWorkspaceIndexerSettings();
    const merged =
      nextSettings && typeof nextSettings === "object" && !Array.isArray(nextSettings)
        ? { ...previous, ...(nextSettings as Record<string, unknown>) }
        : nextSettings;
    const settings = config.setWorkspaceIndexerSettings(merged);
    const embeddingSelectionChanged =
      previous.embeddingProvider !== settings.embeddingProvider ||
      previous.embeddingModel !== settings.embeddingModel;

    if (!settings.enabled && this.state === "indexing") {
      this.stop();
    }
    if (embeddingSelectionChanged) {
      this.semanticReady = false;
      const reindexTarget = this.indexedWorkspacePath;
      if (settings.enabled && reindexTarget && !isHomeRootPath(reindexTarget)) {
        this.semanticError = "Embedding model changed — reindexing semantic vectors…";
        void this.reindex(reindexTarget).catch(() => undefined);
      } else {
        this.semanticError =
          "Embedding provider/model changed. Run Reindex to refresh semantic vectors.";
      }
    }
    return settings;
  }

  async getEmbeddingCatalog() {
    const settings = config.getWorkspaceIndexerSettings();
    return await getEmbeddingProviderCatalog({
      provider: settings.embeddingProvider,
      model: settings.embeddingModel,
    });
  }

  getEmbeddingRuntimeStatus(selection?: { provider?: string; model?: string }): {
    selectedProvider: string;
    selectedModel: string;
    vectorProvider: string;
    vectorModel: string;
    vectorFallbackReason: string | null;
    transformers: {
      selectedModel: string;
      selectedState: "idle" | "loading" | "ready" | "error";
      loadedModels: Array<{
        model: string;
        state: "idle" | "loading" | "ready" | "error";
        loadedAt: string | null;
        lastUsedAt: string | null;
        lastError: string | null;
        device: string;
        dtype: string;
        cacheDir: string;
        loadProgress: number | null;
        loadStatus: string | null;
        estimatedModelBytes: number | null;
        residentMemoryBytes: number | null;
        vramBytes: number | null;
        memoryNote: string | null;
      }>;
    };
  } {
    const settings = config.getWorkspaceIndexerSettings();
    const providerPreference =
      typeof selection?.provider === "string" && selection.provider.trim()
        ? selection.provider.trim()
        : settings.embeddingProvider;
    const modelPreference =
      typeof selection?.model === "string" && selection.model.trim()
        ? selection.model.trim()
        : settings.embeddingModel;

    const vectorStore = getVectorStore();
    return vectorStore.getLocalRuntimeStatus({
      provider: providerPreference as EmbeddingProviderPreference,
      model: modelPreference,
    });
  }

  async loadEmbeddingRuntime(selection?: { provider?: string; model?: string }): Promise<{
    success: boolean;
    provider: string;
    model: string;
    message: string;
  }> {
    const settings = config.getWorkspaceIndexerSettings();
    const providerPreference =
      typeof selection?.provider === "string" && selection.provider.trim()
        ? selection.provider.trim()
        : settings.embeddingProvider;
    const modelPreference =
      typeof selection?.model === "string" && selection.model.trim()
        ? selection.model.trim()
        : settings.embeddingModel;

    const vectorStore = getVectorStore();
    return await vectorStore.startLocalRuntime({
      provider: providerPreference as EmbeddingProviderPreference,
      model: modelPreference,
    });
  }

  async stopEmbeddingRuntime(selection?: { provider?: string; model?: string }): Promise<{
    success: boolean;
    provider: string;
    model: string;
    message: string;
  }> {
    const settings = config.getWorkspaceIndexerSettings();
    const providerPreference =
      typeof selection?.provider === "string" && selection.provider.trim()
        ? selection.provider.trim()
        : settings.embeddingProvider;
    const modelPreference =
      typeof selection?.model === "string" && selection.model.trim()
        ? selection.model.trim()
        : settings.embeddingModel;

    const vectorStore = getVectorStore();
    await vectorStore.configureEmbeddings({
      provider: providerPreference as EmbeddingProviderPreference,
      model: modelPreference,
    });

    const stats = vectorStore.stats();
    const provider =
      providerPreference !== "auto"
        ? providerPreference
        : stats.provider !== "none"
          ? stats.provider
          : "auto";
    const model = modelPreference || (stats.model !== "none" ? stats.model : "");

    const result = await vectorStore.stopLocalRuntime({
      provider: provider as EmbeddingProviderPreference,
      model,
    });

    if (result.success) {
      this.semanticError = null;
    } else {
      this.semanticError = result.message;
    }
    return result;
  }

  async setWorkspace(pathValue: string): Promise<WorkspaceIndexerStatus> {
    const resolvedWorkspacePath = this.resolveWorkspacePath(pathValue);
    this.workspacePath = resolvedWorkspacePath;
    if (isHomeRootPath(resolvedWorkspacePath)) {
      this.resetToIdle("home_workspace");
      return this.getStatus();
    }

    const settings = config.getWorkspaceIndexerSettings();
    if (settings.enabled && settings.autoReindexOnWorkspaceSet) {
      await this.startIndex(resolvedWorkspacePath, "workspace_set");
    } else if (this.state === "idle" || this.state === "stopped") {
      this.progress = 0;
      this.error = null;
    }
    return this.getStatus();
  }

  async reindex(pathValue?: string): Promise<WorkspaceIndexerStatus> {
    const targetPath = pathValue
      ? this.resolveWorkspacePath(pathValue)
      : this.workspacePath || this.indexedWorkspacePath;
    if (!targetPath) {
      throw new Error("No workspace selected for indexing");
    }
    if (isHomeRootPath(targetPath)) {
      throw new Error(
        "Workspace indexer is disabled for the home directory. Select a project folder."
      );
    }
    this.workspacePath = targetPath;
    await this.startIndex(targetPath, "manual_reindex");
    return this.getStatus();
  }

  stop(): WorkspaceIndexerStatus {
    if (this.state !== "indexing") {
      return this.getStatus();
    }

    this.activeToken = null;
    this.runSequence += 1;
    const finishedAt = new Date().toISOString();
    this.state = "stopped";
    this.finishedAt = finishedAt;
    this.durationMs = this.startedAt
      ? Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt))
      : this.durationMs;
    this.error = null;
    return this.getStatus();
  }

  async search(
    queryValue: string,
    options?: { workspacePath?: string | null; limit?: number }
  ): Promise<WorkspaceIndexerSearchResult> {
    const limit = clamp(options?.limit ?? 250, 1, 5000);
    const query = typeof queryValue === "string" ? queryValue.trim() : "";
    const requestedPath = options?.workspacePath?.trim();
    let resolvedRequestedPath: string | null = this.workspacePath;
    if (requestedPath) {
      try {
        resolvedRequestedPath = this.resolveWorkspacePath(requestedPath);
      } catch {
        return {
          success: false,
          source: "index",
          indexed: false,
          indexState: this.state,
          path: requestedPath,
          workspacePath: this.workspacePath,
          query,
          totalFiles: 0,
          truncated: false,
          semanticMatches: 0,
          files: [],
          error: "invalid_workspace_path",
        };
      }
    }
    const indexedPath = this.indexedWorkspacePath;

    if (!indexedPath) {
      return {
        success: false,
        source: "index",
        indexed: false,
        indexState: this.state,
        path: resolvedRequestedPath || requestedPath || "~",
        workspacePath: this.workspacePath,
        query,
        totalFiles: 0,
        truncated: false,
        semanticMatches: 0,
        files: [],
        error: "index_not_available",
      };
    }

    const targetPath = resolvedRequestedPath || indexedPath;
    if (resolve(targetPath) !== resolve(indexedPath)) {
      return {
        success: false,
        source: "index",
        indexed: false,
        indexState: this.state,
        path: targetPath,
        workspacePath: this.workspacePath,
        query,
        totalFiles: 0,
        truncated: false,
        semanticMatches: 0,
        files: [],
        error: "index_workspace_mismatch",
      };
    }

    const normalizedQuery = query.toLowerCase();
    const matchingFiles = normalizedQuery
      ? this.indexedFiles.filter(
          (file) =>
            file.relativePathLower.includes(normalizedQuery) ||
            file.baseNameLower.includes(normalizedQuery)
        )
      : this.indexedFiles;

    const rankedFiles = [...matchingFiles].sort((left, right) => {
      const leftScore = scoreIndexedFile(left.relativePath, query);
      const rightScore = scoreIndexedFile(right.relativePath, query);
      if (leftScore !== rightScore) return leftScore - rightScore;
      if (left.relativePath.length !== right.relativePath.length) {
        return left.relativePath.length - right.relativePath.length;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });

    const rankedByPath = new Map(
      rankedFiles.map((file) => [
        file.relativePathLower,
        scoreIndexedFile(file.relativePath, query),
      ])
    );
    const indexedByPath = new Map(this.indexedFiles.map((file) => [file.relativePathLower, file]));
    const combined = new Map<
      string,
      { file: IndexedFileRecord; lexicalScore: number; semanticScore: number }
    >();

    for (const file of rankedFiles) {
      combined.set(file.relativePathLower, {
        file,
        lexicalScore: rankedByPath.get(file.relativePathLower) ?? 10,
        semanticScore: 0,
      });
    }

    let semanticMatches = 0;
    const settings = config.getWorkspaceIndexerSettings();
    if (query.length > 0 && settings.semanticEnabled && this.semanticReady) {
      try {
        const vectorStore = getVectorStore();
        await vectorStore.configureEmbeddings({
          provider: settings.embeddingProvider,
          model: settings.embeddingModel,
        });
        await vectorStore.ensureReady();
        const workspacePrefix = this.getWorkspaceSemanticPrefix(indexedPath);
        const vectorResults = await vectorStore.search(query, {
          source: "workspace",
          maxResults: Math.min(Math.max(limit * 2, 50), 5000),
          minScore: settings.semanticMinScore,
        });
        const seenSemantic = new Set<string>();

        for (const result of vectorResults) {
          if (!result.path.startsWith(`${workspacePrefix}/`)) continue;
          const relativePath = result.path.slice(workspacePrefix.length + 1);
          if (!relativePath) continue;
          const key = relativePath.toLowerCase();
          const indexedFile = indexedByPath.get(key);
          if (!indexedFile) continue;
          seenSemantic.add(key);
          const existing = combined.get(key);
          if (existing) {
            existing.semanticScore = Math.max(existing.semanticScore, result.score);
            continue;
          }
          combined.set(key, {
            file: indexedFile,
            lexicalScore: Math.min(scoreIndexedFile(indexedFile.relativePath, query), 6.5),
            semanticScore: result.score,
          });
        }

        semanticMatches = seenSemantic.size;
      } catch (errorValue) {
        const message =
          errorValue instanceof Error
            ? errorValue.message
            : `Semantic search error: ${String(errorValue)}`;
        this.semanticError = message;
      }
    }

    const rankedCombined = [...combined.values()].sort((left, right) => {
      const leftScore = left.lexicalScore - left.semanticScore * 2;
      const rightScore = right.lexicalScore - right.semanticScore * 2;
      if (leftScore !== rightScore) return leftScore - rightScore;
      if (left.file.relativePath.length !== right.file.relativePath.length) {
        return left.file.relativePath.length - right.file.relativePath.length;
      }
      return left.file.relativePath.localeCompare(right.file.relativePath);
    });

    const files = rankedCombined.slice(0, limit).map((entry) => ({
      path: entry.file.path,
      relativePath: entry.file.relativePath,
    }));

    return {
      success: true,
      source: "index",
      indexed: true,
      indexState: this.state,
      path: targetPath,
      workspacePath: this.workspacePath,
      query,
      totalFiles: rankedCombined.length,
      truncated: rankedCombined.length > limit,
      semanticMatches,
      files,
    };
  }

  private getWorkspaceSemanticPrefix(workspacePath: string): string {
    const digest = createHash("sha1")
      .update(resolveCanonicalPath(workspacePath))
      .digest("hex")
      .slice(0, 12);
    return `workspace://${digest}`;
  }

  private resolveWorkspacePath(pathValue: string): string {
    if (!pathValue || typeof pathValue !== "string") {
      throw new Error("Workspace path is required");
    }
    const normalizedInput = expandHomePath(pathValue.trim());
    const absolutePath = isAbsolute(normalizedInput)
      ? normalizedInput
      : resolve(process.cwd(), normalizedInput);
    if (!existsSync(absolutePath)) {
      throw new Error("Workspace path does not exist");
    }

    const canonicalPath = resolveCanonicalPath(absolutePath);
    if (!isWithinHome(canonicalPath)) {
      throw new Error("Workspace path must be inside home directory");
    }

    const stats = statSync(canonicalPath);
    if (stats.isDirectory()) return canonicalPath;
    return resolveCanonicalPath(join(canonicalPath, ".."));
  }

  private ensureActive(token: number): void {
    if (this.activeToken !== token) {
      throw new Error("__INDEX_CANCELLED__");
    }
  }

  private resetToIdle(reason: string): void {
    this.activeToken = null;
    this.runSequence += 1;
    this.state = "idle";
    this.indexedWorkspacePath = null;
    this.indexedFiles = [];
    this.filesIndexed = 0;
    this.filesScanned = 0;
    this.directoriesScanned = 0;
    this.skippedFiles = 0;
    this.progress = 0;
    this.startedAt = null;
    this.finishedAt = null;
    this.durationMs = null;
    this.lastIndexedAt = null;
    this.semanticReady = false;
    this.semanticProvider = null;
    this.semanticModel = null;
    this.semanticIndexedFiles = 0;
    this.semanticIndexedChunks = 0;
    this.semanticError = null;
    this.error = null;
    log.info("Indexer reset to idle", {
      workspacePath: this.workspacePath,
      reason,
    });
  }

  private updateIndexingProgress(settings: WorkspaceIndexerSettings): void {
    const target = Math.max(1, settings.maxFiles);
    const indexedRatio = target > 0 ? this.filesIndexed / target : 0;
    this.progress = Math.min(40, Math.max(0, Math.floor(indexedRatio * 40)));
  }

  private shouldSkipDirectory(name: string, settings: WorkspaceIndexerSettings): boolean {
    const normalizedName = name.trim().toLowerCase();
    if (HARD_IGNORE_DIRS.has(normalizedName)) return true;
    if (!settings.includeHidden && name.startsWith(".")) return true;
    return settings.ignoreDirs.includes(normalizedName);
  }

  private shouldSkipFile(
    fileName: string,
    fileSize: number,
    settings: WorkspaceIndexerSettings
  ): boolean {
    if (!settings.includeHidden && fileName.startsWith(".")) return true;
    if (HARD_IGNORE_FILES.has(fileName.trim().toLowerCase())) return true;
    if (fileSize > settings.maxFileSizeBytes) return true;
    const extension = extname(fileName).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) return true;
    if (settings.includeExtensions.length > 0 && !settings.includeExtensions.includes(extension)) {
      return true;
    }
    return false;
  }

  private async startIndex(workspacePath: string, reason: string): Promise<void> {
    const settings = config.getWorkspaceIndexerSettings();
    if (!settings.enabled) {
      this.state = "idle";
      this.error = null;
      return;
    }
    if (isHomeRootPath(workspacePath)) {
      this.resetToIdle("home_workspace_start_skipped");
      return;
    }

    const token = ++this.runSequence;
    const previousIndexedFiles =
      this.indexedWorkspacePath && resolve(this.indexedWorkspacePath) === resolve(workspacePath)
        ? [...this.indexedFiles]
        : [];
    this.activeToken = token;
    this.state = "indexing";
    this.error = null;
    this.filesIndexed = 0;
    this.filesScanned = 0;
    this.directoriesScanned = 0;
    this.skippedFiles = 0;
    this.progress = 0;
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.durationMs = null;
    this.semanticReady = false;
    this.semanticProvider = null;
    this.semanticModel = null;
    this.semanticIndexedFiles = 0;
    this.semanticIndexedChunks = 0;
    this.semanticError = null;

    const discoveredFiles: IndexedFileRecord[] = [];
    const pendingDirs: string[] = [workspacePath];
    let maxFilesReached = false;

    log.info("Indexing started", {
      workspacePath,
      reason,
      maxFiles: settings.maxFiles,
      maxFileSizeBytes: settings.maxFileSizeBytes,
    });

    try {
      while (pendingDirs.length > 0 && !maxFilesReached) {
        this.ensureActive(token);
        const currentDir = pendingDirs.pop();
        if (!currentDir) break;
        this.directoriesScanned += 1;

        let entries: Awaited<ReturnType<typeof readdir>>;
        try {
          entries = await readdir(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          this.ensureActive(token);
          if (entry.isSymbolicLink()) continue;
          const entryName = entry.name;
          const entryPath = join(currentDir, entryName);

          if (entry.isDirectory()) {
            if (this.shouldSkipDirectory(entryName, settings)) continue;
            pendingDirs.push(entryPath);
            continue;
          }

          if (!entry.isFile()) continue;
          this.filesScanned += 1;

          let fileStats: Awaited<ReturnType<typeof stat>>;
          try {
            fileStats = await stat(entryPath);
          } catch {
            this.skippedFiles += 1;
            continue;
          }

          if (this.shouldSkipFile(entryName, fileStats.size, settings)) {
            this.skippedFiles += 1;
            continue;
          }

          const relativePath = relative(workspacePath, entryPath).replaceAll("\\", "/");
          discoveredFiles.push({
            path: entryPath,
            relativePath,
            relativePathLower: relativePath.toLowerCase(),
            baseNameLower: basename(relativePath).toLowerCase(),
            sizeBytes: fileStats.size,
          });
          this.filesIndexed = discoveredFiles.length;

          if (this.filesIndexed >= settings.maxFiles) {
            maxFilesReached = true;
            break;
          }

          if (this.filesScanned % STATUS_UPDATE_INTERVAL === 0) {
            this.updateIndexingProgress(settings);
            // Yield periodically so API/status polling remains responsive.
            await new Promise<void>((resolveYield) => setTimeout(resolveYield, 0));
          }
        }
      }

      this.ensureActive(token);
      this.indexedFiles = discoveredFiles.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath)
      );
      this.indexedWorkspacePath = workspacePath;
      this.lastIndexedAt = new Date().toISOString();
      this.error = null;
      this.progress = settings.semanticEnabled ? 42 : 100;

      if (settings.semanticEnabled && this.indexedFiles.length > 0) {
        await this.indexSemanticWorkspace(workspacePath, token, settings, previousIndexedFiles);
      }

      this.state = "ready";
      this.progress = 100;
      if (maxFilesReached) {
        log.warn("Indexing reached max file limit", {
          workspacePath,
          maxFiles: settings.maxFiles,
          filesIndexed: this.filesIndexed,
        });
      } else {
        log.info("Indexing completed", {
          workspacePath,
          filesIndexed: this.filesIndexed,
          filesScanned: this.filesScanned,
          directoriesScanned: this.directoriesScanned,
          skippedFiles: this.skippedFiles,
        });
      }
    } catch (errorValue) {
      if ((errorValue as Error)?.message === "__INDEX_CANCELLED__") {
        log.info("Indexing cancelled", { workspacePath, reason });
        return;
      }

      const message =
        errorValue instanceof Error
          ? errorValue.message
          : `Unexpected indexer error: ${String(errorValue)}`;
      this.state = "error";
      this.error = message;
      this.progress = 0;
      log.error("Indexing failed", {
        workspacePath,
        reason,
        error: message,
      });
    } finally {
      if (this.activeToken === token) {
        this.activeToken = null;
        this.finishedAt = new Date().toISOString();
        this.durationMs = this.startedAt
          ? Math.max(0, Date.parse(this.finishedAt) - Date.parse(this.startedAt))
          : null;
      }
    }
  }

  private async indexSemanticWorkspace(
    workspacePath: string,
    token: number,
    settings: WorkspaceIndexerSettings,
    previousIndexedFiles: IndexedFileRecord[]
  ): Promise<void> {
    const semanticCandidates = this.indexedFiles
      .filter((file) => file.sizeBytes <= SEMANTIC_WORKSPACE_MAX_FILE_SIZE_BYTES)
      .slice(0, settings.semanticMaxFiles);
    if (semanticCandidates.length === 0) {
      this.semanticReady = false;
      return;
    }

    const workspacePrefix = this.getWorkspaceSemanticPrefix(workspacePath);

    try {
      const vectorStore = getVectorStore();
      await vectorStore.configureEmbeddings({
        provider: settings.embeddingProvider,
        model: settings.embeddingModel,
      });
      await vectorStore.ensureReady();

      const statsBefore = vectorStore.stats();
      this.semanticProvider = statsBefore.provider || null;
      this.semanticModel = statsBefore.model || null;

      if (!statsBefore.provider || statsBefore.provider === "none") {
        this.semanticReady = false;
        this.semanticError = "No embedding provider configured";
        return;
      }

      for (const file of previousIndexedFiles) {
        this.ensureActive(token);
        vectorStore.removeFile(`${workspacePrefix}/${file.relativePath}`);
      }

      let indexedFileCount = 0;
      let indexedChunkCount = 0;

      for (let index = 0; index < semanticCandidates.length; index += 1) {
        this.ensureActive(token);
        const candidate = semanticCandidates[index];

        try {
          const content = await readFile(candidate.path, "utf-8");
          const chunks = await vectorStore.indexFile(
            `${workspacePrefix}/${candidate.relativePath}`,
            content,
            "workspace",
            {
              embeddingBatchSize: SEMANTIC_WORKSPACE_EMBEDDING_BATCH_SIZE,
              embeddingConcurrency: SEMANTIC_WORKSPACE_EMBEDDING_CONCURRENCY,
            }
          );
          if (chunks > 0) {
            indexedFileCount += 1;
            indexedChunkCount += chunks;
          }
        } catch {
          continue;
        }

        const ratio = (index + 1) / semanticCandidates.length;
        this.progress = Math.max(this.progress, Math.min(99, Math.floor(40 + ratio * 59)));
        this.semanticIndexedFiles = indexedFileCount;
        this.semanticIndexedChunks = indexedChunkCount;
        await new Promise<void>((resolveYield) => setTimeout(resolveYield, 0));
      }

      this.semanticIndexedFiles = indexedFileCount;
      this.semanticIndexedChunks = indexedChunkCount;
      this.semanticReady = indexedChunkCount > 0;
      if (indexedChunkCount === 0) {
        this.semanticError = "No semantic chunks indexed";
      } else {
        this.semanticError = null;
      }
    } catch (errorValue) {
      if ((errorValue as Error)?.message === "__INDEX_CANCELLED__") {
        throw errorValue;
      }
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : `Semantic indexing error: ${String(errorValue)}`;
      this.semanticReady = false;
      this.semanticError = message;
      log.warn("Semantic indexing failed", {
        workspacePath,
        error: message,
      });
    }
  }
}

export const workspaceIndexer = new WorkspaceIndexer();
