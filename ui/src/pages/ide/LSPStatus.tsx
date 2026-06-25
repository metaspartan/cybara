/** LSP status bar widget — shows active language servers for the current file. */
import { useState, useEffect, useRef } from "react";
import { ChevronDown, Zap } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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
    const fallbackLanguage = getActiveLanguageFromExtension(activeExtension);
    if (!activeFilePath) {
      setServers([]);
      setLanguageId(fallbackLanguage);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    const fetchStatus = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/lsp/active?path=${encodeURIComponent(activeFilePath)}`);
        const data = await res.json();
        if (isCancelled) return;
        setServers(Array.isArray(data?.servers) ? (data.servers as LspActiveServer[]) : []);
        setLanguageId(
          typeof data?.languageId === "string" && data.languageId
            ? data.languageId
            : fallbackLanguage
        );
        if (data?.success === false && typeof data?.error === "string") {
          setError(data.error);
        }
      } catch (err) {
        if (isCancelled) return;
        setServers([]);
        setLanguageId(fallbackLanguage);
        setError((err as Error)?.message || "Failed to load LSP status");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };
    void fetchStatus();
    return () => {
      isCancelled = true;
    };
  }, [activeExtension, activeFilePath]);

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
          onClick={() => setIsOpen((previous) => !previous)}
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
              <div className="text-xs font-medium text-gray-200">Language Servers</div>
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
