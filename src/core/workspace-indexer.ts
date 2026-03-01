import { readdir, stat } from "fs/promises";
import { existsSync, realpathSync, statSync } from "fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import {
  config,
  type WorkspaceIndexerSettings,
} from "./config";
import { createLogger } from "./logger";

type WorkspaceIndexerState = "idle" | "indexing" | "ready" | "stopped" | "error";

interface IndexedFileRecord {
  path: string;
  relativePath: string;
  relativePathLower: string;
  baseNameLower: string;
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

    if (!settings.enabled && this.state === "indexing") {
      this.stop();
    }
    return settings;
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
      throw new Error("Workspace indexer is disabled for the home directory. Select a project folder.");
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

  search(
    queryValue: string,
    options?: { workspacePath?: string | null; limit?: number }
  ): WorkspaceIndexerSearchResult {
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

    const files = rankedFiles.slice(0, limit).map((file) => ({
      path: file.path,
      relativePath: file.relativePath,
    }));

    return {
      success: true,
      source: "index",
      indexed: true,
      indexState: this.state,
      path: targetPath,
      workspacePath: this.workspacePath,
      query,
      totalFiles: rankedFiles.length,
      truncated: rankedFiles.length > limit,
      files,
    };
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
    this.error = null;
    log.info("Indexer reset to idle", {
      workspacePath: this.workspacePath,
      reason,
    });
  }

  private updateIndexingProgress(settings: WorkspaceIndexerSettings): void {
    const target = Math.max(1, settings.maxFiles);
    const indexedRatio = target > 0 ? this.filesIndexed / target : 0;
    this.progress = Math.min(99, Math.max(0, Math.floor(indexedRatio * 100)));
  }

  private shouldSkipDirectory(name: string, settings: WorkspaceIndexerSettings): boolean {
    if (!settings.includeHidden && name.startsWith(".")) return true;
    const normalizedName = name.trim().toLowerCase();
    return settings.ignoreDirs.includes(normalizedName);
  }

  private shouldSkipFile(
    fileName: string,
    fileSize: number,
    settings: WorkspaceIndexerSettings
  ): boolean {
    if (!settings.includeHidden && fileName.startsWith(".")) return true;
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
      this.state = "ready";
      this.progress = 100;
      this.lastIndexedAt = new Date().toISOString();
      this.error = null;
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
        errorValue instanceof Error ? errorValue.message : `Unexpected indexer error: ${String(errorValue)}`;
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
}

export const workspaceIndexer = new WorkspaceIndexer();
