export const PARALLEL_SAFE_TOOLS = new Set<string>([
  "read",
  "file_search",
  "grep",
  "workspace_index_search",
  "web_search",
  "web_fetch",
  "x_search",
  "memory_search",
  "memory_get",
  "memory_context",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_languages",
  "weather",
  "calc",
  "convert",
  "pdf",
  "ocr",
  "tool_search",
  "tool_describe",
  "sessions_history",
  "sessions_list",
  "session_status",
  "agents_list",
]);

export function isParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(name);
}

export function canRunToolsInParallel(names: string[]): boolean {
  if (names.length < 2) return false;
  return names.every((n) => typeof n === "string" && PARALLEL_SAFE_TOOLS.has(n));
}
