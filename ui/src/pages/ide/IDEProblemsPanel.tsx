import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Diagnostic } from "./ideTypes";

type WorkspaceDiagnostic = Diagnostic & { file: string };

function diagnosticIcon(severity: Diagnostic["severity"]): ReactElement {
  if (severity === "error") return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
  if (severity === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />;
  return <Info className="h-3.5 w-3.5 text-sky-300" />;
}

function getRelativeDiagnosticPath(file: string, workspacePath: string): string {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedFile.startsWith(`${normalizedWorkspace}/`)
    ? normalizedFile.slice(normalizedWorkspace.length + 1)
    : file;
}

export function IDEProblemsPanel({
  workspacePath,
  onOpenLocation,
}: {
  workspacePath: string;
  onOpenLocation: (file: string, line: number) => void;
}): ReactElement {
  const [issues, setIssues] = useState<WorkspaceDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequenceRef.current;
    if (!workspacePath) {
      setIssues([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/lsp/diagnostics?path=${encodeURIComponent(workspacePath)}`
      );
      const value: unknown = await response.json();
      const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      if (sequence !== requestSequenceRef.current) return;
      if (!response.ok || record.success === false) {
        throw new Error(typeof record.error === "string" ? record.error : "Diagnostics failed");
      }
      setIssues(Array.isArray(record.issues) ? (record.issues as WorkspaceDiagnostic[]) : []);
    } catch (cause) {
      if (sequence !== requestSequenceRef.current) return;
      setIssues([]);
      setError(cause instanceof Error ? cause.message : "Failed to load diagnostics");
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 5_000);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      requestSequenceRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [refresh]);

  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errorCount += 1;
    if (issue.severity === "warning") warningCount += 1;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0a0a10]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] text-gray-500">
        <span>{errorCount} errors</span>
        <span>·</span>
        <span>{warningCount} warnings</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:opacity-50"
          title="Refresh problems"
          aria-label="Refresh problems"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>
      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && issues.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading problems
          </div>
        ) : issues.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">
            No problems reported for opened files.
          </div>
        ) : (
          issues.map((issue) => {
            const relativePath = getRelativeDiagnosticPath(issue.file, workspacePath);
            return (
              <button
                key={`${issue.file}:${issue.line}:${issue.character}:${issue.message}:${issue.source || ""}:${String(issue.code ?? "")}`}
                type="button"
                onClick={() => onOpenLocation(issue.file, issue.line + 1)}
                className="w-full border-b border-white/5 px-3 py-2 text-left [contain-intrinsic-size:auto_48px] [content-visibility:auto] hover:bg-white/5"
                title={`${issue.file}:${issue.line + 1}:${issue.character + 1}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{diagnosticIcon(issue.severity)}</span>
                  <span className="min-w-0">
                    <span className="block text-xs leading-5 text-gray-200">{issue.message}</span>
                    <span className="block truncate text-[10px] text-gray-500">
                      {relativePath}:{issue.line + 1}:{issue.character + 1}
                      {issue.source ? ` · ${issue.source}` : ""}
                      {issue.code !== undefined ? `(${String(issue.code)})` : ""}
                    </span>
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
