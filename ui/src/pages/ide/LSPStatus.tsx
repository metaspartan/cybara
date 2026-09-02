import { useCallback, useState, useEffect, useEffectEvent, useRef } from "react";
import { ChevronDown, RefreshCw, RotateCcw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { getActiveLanguageFromExtension } from "./ideLanguageMaps";
import type { LspActiveServer } from "./ideTypes";

export function LSPStatus({
  compact = false,
  activeFilePath,
  activeExtension,
}: {
  compact?: boolean;
  activeFilePath?: string | null;
  activeExtension?: string | null;
}) {
  const [languageId, setLanguageId] = useState<string | null>(
    getActiveLanguageFromExtension(activeExtension)
  );
  const [servers, setServers] = useState<LspActiveServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const fallbackLanguage = getActiveLanguageFromExtension(activeExtension);
    if (!activeFilePath) {
      setServers([]);
      setLanguageId(fallbackLanguage);
      setError(null);
      setIsLoading(false);
      return;
    }

    const sequence = ++requestSequenceRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/lsp/active?path=${encodeURIComponent(activeFilePath)}`);
      const value: unknown = await res.json();
      if (sequence !== requestSequenceRef.current) return;
      const data = value && typeof value === "object" ? value : {};
      const record = data as Record<string, unknown>;
      setServers(Array.isArray(record.servers) ? (record.servers as LspActiveServer[]) : []);
      setLanguageId(
        typeof record.languageId === "string" && record.languageId
          ? record.languageId
          : fallbackLanguage
      );
      if (record.success === false && typeof record.error === "string") setError(record.error);
    } catch (err) {
      if (sequence !== requestSequenceRef.current) return;
      setServers([]);
      setLanguageId(fallbackLanguage);
      setError(err instanceof Error ? err.message : "Failed to load LSP status");
    } finally {
      if (sequence === requestSequenceRef.current) setIsLoading(false);
    }
  }, [activeExtension, activeFilePath]);
  const refreshWhenVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible") void refreshStatus();
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("mousedown", handleClickAway);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickAway);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    void refreshStatus();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!activeFilePath) return;
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeFilePath]);

  const restartServers = async (): Promise<void> => {
    if (!activeFilePath || isRestarting) return;
    setIsRestarting(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/lsp/restart?path=${encodeURIComponent(activeFilePath)}`,
        { method: "POST" }
      );
      const value: unknown = await response.json();
      const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      if (!response.ok || record.success === false) {
        throw new Error(typeof record.error === "string" ? record.error : "Restart failed");
      }
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart language servers");
    } finally {
      setIsRestarting(false);
    }
  };

  const runningCount = servers.filter((server) => server.running && server.initialized).length;
  const availableCount = servers.filter((server) => server.available).length;
  const summaryLabel = isLoading
    ? "loading"
    : runningCount > 0
      ? `${runningCount} active`
      : availableCount > 0
        ? `${availableCount} ready`
        : "none";
  const summaryClass =
    runningCount > 0 ? "text-emerald-400" : availableCount > 0 ? "text-amber-300" : "text-gray-600";

  return (
    <div
      className={cn(
        compact
          ? "flex items-center gap-2 text-xs text-gray-500"
          : "px-3 py-2 border-t border-white/10 bg-white/5"
      )}
    >
      <div ref={popoverRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setIsOpen((previous) => !previous);
            void refreshStatus();
          }}
          className="inline-flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-white/5"
          title="Show active language servers"
        >
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Zap className="w-3 h-3" />
            <span>LSP:</span>
            <span className={summaryClass}>{summaryLabel}</span>
            <span className="text-gray-600">{languageId || "unknown"}</span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
          </div>
        </button>
        {isOpen && (
          <div className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-[360px] overflow-hidden rounded-md border border-white/10 bg-[#0b0f19] shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
            <div className="border-b border-white/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-gray-200">Language Servers</div>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={isLoading}
                  className="ml-auto rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:opacity-50"
                  title="Refresh language server status"
                  aria-label="Refresh language server status"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                </button>
                <button
                  type="button"
                  onClick={() => void restartServers()}
                  disabled={!activeFilePath || isRestarting}
                  className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:opacity-50"
                  title="Restart language servers for this workspace"
                  aria-label="Restart language servers for this workspace"
                >
                  <RotateCcw className={cn("h-3.5 w-3.5", isRestarting && "animate-spin")} />
                </button>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                {languageId || "unknown"} • {runningCount}/{servers.length} running
              </div>
            </div>
            {error ? (
              <div className="px-3 py-2 text-[11px] text-red-300">{error}</div>
            ) : servers.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-500">
                No servers configured for this file.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto py-1">
                {servers.map((server) => {
                  const statusLabel =
                    server.running && server.initialized
                      ? "running"
                      : server.available
                        ? "available"
                        : "unavailable";
                  const statusClass =
                    server.running && server.initialized
                      ? "text-emerald-300"
                      : server.available
                        ? "text-amber-300"
                        : "text-red-300";
                  return (
                    <div
                      key={`lsp-server:${server.id}`}
                      className="border-b border-white/5 px-3 py-2 text-[11px] last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-200">{server.name}</span>
                        {server.primary && (
                          <span className="rounded border border-indigo-400/40 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200">
                            primary
                          </span>
                        )}
                        {server.bundled && (
                          <span className="rounded border border-cyan-400/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-200">
                            bundled
                          </span>
                        )}
                        <span className={cn("ml-auto font-medium", statusClass)}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-gray-500">
                        {server.command}
                        {Array.isArray(server.args) && server.args.length > 0
                          ? ` ${server.args.join(" ")}`
                          : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
