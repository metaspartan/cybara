/** Extension -> LSP/Prism language maps — extracted from IDE.tsx. */
export function getActiveLanguageFromExtension(extension?: string | null): string | null {
  if (!extension) return null;
  const ext = extension.toLowerCase();
  const languageByExtension: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "css",
    ".json": "json",
    ".jsonc": "json",
    ".go": "go",
    ".rs": "rust",
    ".py": "python",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
  };
  return languageByExtension[ext] || null;
}
