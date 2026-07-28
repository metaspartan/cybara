import type { GitHistoryStatus, IdePendingFileDiff } from "./ideTypes";

export interface CodeViewerProps {
  path: string | null;
  previewMode?: boolean;
  autoRefresh: boolean;
  jumpToLineRequest?: number | null;
  externalRefreshKey?: number;
  saveRequestToken?: number;
  onSaveSuccess?: () => void;
  onCursorChange?: (position: { line: number; column: number } | null) => void;
  onGitHistoryStatusChange?: (status: GitHistoryStatus) => void;
  onOpenLocation?: (filePath: string, line: number) => void;
  completionAgentId?: string | null;
  editorFontSizePx?: number;
  editorLineHeightPx?: number;
  showMinimap?: boolean;
  enableCompletions?: boolean;
  enableGhostCompletions?: boolean;
  completionDebounceMs?: number;
  ghostDebounceMs?: number;
  pendingFileDiffs?: IdePendingFileDiff[];
}

interface CodeViewerConfiguration {
  normalizedFontSize: number;
  normalizedLineHeight: number;
  normalizedCompletionDebounce: number;
  normalizedGhostDebounce: number;
  charWidthPx: number;
  isMarkdownFile: boolean;
}

export function getCodeViewerConfiguration(
  editorFontSizePx: number,
  editorLineHeightPx: number,
  completionDebounceMs: number,
  ghostDebounceMs: number,
  extension: string,
  path: string | null
): CodeViewerConfiguration {
  const normalizedFontSize = Math.max(11, Math.min(22, Math.round(editorFontSizePx)));
  const normalizedLineHeight = Math.max(16, Math.min(38, Math.round(editorLineHeightPx)));
  const normalizedCompletionDebounce = Math.max(
    30,
    Math.min(800, Math.round(completionDebounceMs))
  );
  const normalizedGhostDebounce = Math.max(60, Math.min(1400, Math.round(ghostDebounceMs)));
  const charWidthPx = Math.max(6.4, Math.min(14, Number((normalizedFontSize * 0.586).toFixed(2))));
  const normalizedExtension = extension.toLowerCase().replace(/^\./, "");
  const isMarkdownFile =
    normalizedExtension === "md" ||
    normalizedExtension === "markdown" ||
    normalizedExtension === "mdx" ||
    /\.(md|markdown|mdx)$/i.test(path || "");
  return {
    normalizedFontSize,
    normalizedLineHeight,
    normalizedCompletionDebounce,
    normalizedGhostDebounce,
    charWidthPx,
    isMarkdownFile,
  };
}

export function isCodeViewerLargeFile(
  editContent: string,
  content: string | null,
  characterThreshold: number,
  lineThreshold: number
): boolean {
  const text = editContent || content || "";
  if (text.length >= characterThreshold) return true;
  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount >= lineThreshold) return true;
  }
  return false;
}

export function getMinimapRowBudget(viewportHeight: number): number {
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return Math.max(120, Math.min(360, Math.ceil(height / 2)));
}
