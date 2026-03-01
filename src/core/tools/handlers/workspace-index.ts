import { listWorkspaceFiles } from "../../../api/ide-api";
import { trackMetric } from "../../metrics";
import { workspaceIndexer } from "../../workspace-indexer";

interface WorkspaceIndexSearchResult {
  success: boolean;
  source: "index" | "filesystem";
  indexed: boolean;
  indexState: "idle" | "indexing" | "ready" | "stopped" | "error";
  path: string;
  workspacePath: string | null;
  query: string;
  totalFiles: number;
  truncated: boolean;
  files: Array<{ path: string; relativePath: string }>;
  indexError?: string;
  error?: string;
}

function normalizeQuery(args: Record<string, unknown>): string {
  return typeof args.query === "string" ? args.query.trim() : "";
}

function normalizePath(args: Record<string, unknown>, fallback?: string): string {
  if (typeof args.path === "string" && args.path.trim()) {
    return args.path.trim();
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return "~";
}

function normalizeLimit(args: Record<string, unknown>): number {
  const value = Number(args.limit);
  if (!Number.isFinite(value)) return 250;
  return Math.min(5000, Math.max(1, Math.floor(value)));
}

export async function handleWorkspaceIndexSearch(
  args: Record<string, unknown>,
  context?: { workspaceDir?: string }
): Promise<WorkspaceIndexSearchResult> {
  const query = normalizeQuery(args);
  const limit = normalizeLimit(args);
  const path = normalizePath(args, context?.workspaceDir);

  const indexedResult = workspaceIndexer.search(query, {
    workspacePath: path,
    limit,
  });

  if (indexedResult.success) {
    trackMetric("tool_call", "workspace_index_search", 1, {
      source: "index",
      indexed: true,
      resultCount: indexedResult.files.length,
      totalFiles: indexedResult.totalFiles,
    });
    return indexedResult;
  }

  const fallback = await listWorkspaceFiles(path, { query, limit });
  trackMetric("tool_call", "workspace_index_search", 1, {
    source: "filesystem",
    indexed: false,
    resultCount: fallback.files.length,
    totalFiles: fallback.totalFiles,
    indexError: indexedResult.error || "",
  });

  return {
    ...fallback,
    source: "filesystem",
    indexed: false,
    indexState: indexedResult.indexState,
    indexError: indexedResult.error,
    workspacePath: path,
  };
}
