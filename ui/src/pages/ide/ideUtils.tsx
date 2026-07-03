/** Pure IDE utility helpers + markdown renderers — extracted from IDE.tsx. */
/** @jsxImportSource react */
import React from "react";
import { Components } from "react-markdown";
import { File, FileCode, FileJson, FileText, Info, AlertTriangle, AlertCircle } from "lucide-react";
import type { FileEntry, IdeOutlineSymbol, FlattenedOutlineSymbol } from "./ideTypes";

export function getFileIcon(entry: FileEntry) {
  if (entry.type === "directory") return null;

  const ext = entry.extension?.toLowerCase() || "";
  const codeExts = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".rs",
    ".go",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".php",
    ".lua",
    ".zig",
  ];
  const jsonExts = [".json", ".yaml", ".yml", ".toml"];
  const textExts = [".md", ".txt", ".log", ".env", ".sh", ".bash", ".zsh"];

  if (codeExts.includes(ext)) return <FileCode className="w-4 h-4 text-blue-400" />;
  if (jsonExts.includes(ext)) return <FileJson className="w-4 h-4 text-yellow-400" />;
  if (textExts.includes(ext)) return <FileText className="w-4 h-4 text-gray-400" />;
  return <File className="w-4 h-4 text-gray-500" />;
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDurationMs(durationMs?: number | null): string {
  if (!Number.isFinite(durationMs || 0) || !durationMs || durationMs <= 0) return "0s";
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) return `${Math.max(1, remainingSeconds)}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, content.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < safeIndex; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return {
    line,
    column: safeIndex - lineStart + 1,
  };
}

export function getPrismLanguage(ext?: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "markup",
    ".xml": "markup",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
    ".lua": "lua",
  };
  return map[ext?.toLowerCase() || ""] || "plaintext";
}

export function splitPathForBreadcrumbs(pathValue: string): string[] {
  const normalized = pathValue.replace(/\\/g, "/");
  return normalized.split("/").filter((segment) => segment.length > 0);
}

export function flattenOutlineSymbols(
  symbols: IdeOutlineSymbol[],
  depth = 0,
  prefix = "root"
): FlattenedOutlineSymbol[] {
  const rows: FlattenedOutlineSymbol[] = [];
  symbols.forEach((symbol, index) => {
    const key = `${prefix}:${index}:${symbol.name}:${symbol.line}:${symbol.character}`;
    rows.push({
      ...symbol,
      depth,
      key,
    });
    if (Array.isArray(symbol.children) && symbol.children.length > 0) {
      rows.push(...flattenOutlineSymbols(symbol.children, depth + 1, key));
    }
  });
  return rows;
}

export function getSymbolKindLabel(kind: number): string {
  const labels: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Ctor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Const",
    22: "Enum Member",
    26: "Type",
  };
  return labels[kind] || `Kind ${kind}`;
}

export function fileEntryFromPath(filePath: string): FileEntry {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = separatorIndex >= 0 ? filePath.slice(separatorIndex + 1) : filePath;
  const extensionMatch = fileName.match(/(\.[^.\\/]+)$/);
  return {
    name: fileName,
    path: filePath,
    type: "file",
    extension: extensionMatch?.[1],
  };
}

export function isMarkdownExtension(extension?: string): boolean {
  const ext = (extension || "").toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

export const ideMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 text-2xl font-semibold tracking-tight text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2.5 mt-5 text-xl font-semibold tracking-tight text-white">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-gray-100">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-3 leading-7 text-gray-200 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc pl-5 text-gray-200">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 text-gray-200">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-indigo-400/50 pl-3 text-gray-300">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-white/10 last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-gray-100">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-gray-300">{children}</td>,
  code: ({ className, children }) => {
    const raw = String(children ?? "");
    const isInline = !className && !raw.includes("\n");
    if (isInline) {
      return (
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-indigo-100">
          {children}
        </code>
      );
    }
    return <code className="font-mono text-[12px] text-gray-100">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-[12px] leading-6 text-gray-100">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-indigo-300 underline decoration-indigo-400/50 underline-offset-2 hover:text-indigo-200"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

export function formatBlameStamp(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatBlameDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function scoreQuickOpenResult(relativePath: string, query: string): number {
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

export function getSeverityIcon(severity: "error" | "warning" | "info") {
  switch (severity) {
    case "error":
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case "warning":
      return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
    default:
      return <Info className="w-3 h-3 text-blue-400" />;
  }
}
