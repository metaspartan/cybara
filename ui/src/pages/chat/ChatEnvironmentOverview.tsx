import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, GitBranch, GitCompare, Globe2 } from "lucide-react";
import type { Subagent } from "@/hooks/useApi";
import type { SessionContextUsage, SessionTokenUsage } from "@/types";
import { formatWorkspaceLabel, type FileChangeSummary, type SessionPlanView } from "./chatModel";
import { GitBranchSelector, type GitBranchOption } from "./GitBranchSelector";
import { PlanSummaryCard } from "./PlanSummaryCard";
import { chatWorkspaceTabLabel, type ChatWorkspaceTab } from "./ChatWorkspacePanel";

function EnvironmentSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 text-[12px] font-medium text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function EnvironmentRow({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-gray-500">{icon}</span>
      <span className="w-16 shrink-0 text-gray-300">{label}</span>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function UsageStat({
  description,
  label,
  value,
}: {
  description?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0" title={description}>
      <div className="truncate text-[10px] uppercase text-gray-600">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-medium text-gray-300">{value}</div>
    </div>
  );
}

export function ChatEnvironmentOverview({
  contextUsage,
  currentPlan,
  fileChanges,
  gitBranch,
  gitBranchChanging,
  gitBranchError,
  gitBranchLoading,
  gitBranches,
  isOpen,
  onCreateGitBranch,
  onRefreshGitBranches,
  onSwitchGitBranch,
  onOpenWorkspaceTab,
  previewTabs,
  agentUsingBrowser,
  timeToFirstTokenMs,
  onDismissPlan,
  sessionId,
  subagents,
  tokenUsage,
  toolNames,
  workspaceDir,
}: {
  contextUsage: SessionContextUsage | null;
  currentPlan: SessionPlanView | null;
  fileChanges: FileChangeSummary | null;
  gitBranch: string | null;
  gitBranchChanging: string | null;
  gitBranchError: string | null;
  gitBranchLoading: boolean;
  gitBranches: GitBranchOption[];
  isOpen: boolean;
  onCreateGitBranch: (branch: string) => Promise<void> | void;
  onRefreshGitBranches: () => Promise<void> | void;
  onSwitchGitBranch: (branch: string) => Promise<void> | void;
  onOpenWorkspaceTab: (tab: ChatWorkspaceTab) => void;
  previewTabs: ChatWorkspaceTab[];
  agentUsingBrowser: boolean;
  timeToFirstTokenMs: number | null;
  onDismissPlan: () => void;
  sessionId: string | null;
  subagents: Subagent[];
  tokenUsage: SessionTokenUsage | null;
  toolNames: string[];
  workspaceDir: string | null;
}) {
  if (!isOpen) return null;

  const contextPercent = Math.max(0, Math.min(100, contextUsage?.usedPercent || 0));
  const hasTokenUsage = Boolean(tokenUsage && tokenUsage.totalTokens > 0);
  const latestFirstTokenMs = tokenUsage?.firstTokenMs ?? timeToFirstTokenMs;

  const panel = (
    <div
      className="chat-environment-panel fixed right-3 top-[52px] z-[2147483000] max-h-[calc(100vh-68px)] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border p-3 text-sm"
      data-session-id={sessionId || "new-chat"}
      data-testid="chat-environment-overview"
      style={{
        WebkitBackdropFilter: "none",
        backdropFilter: "none",
        background: "var(--chat-environment-panel-bg)",
        backgroundColor: "var(--chat-environment-panel-bg)",
        borderColor: "var(--chat-environment-panel-border)",
        color: "var(--chat-environment-panel-text)",
        opacity: 1,
      }}
    >
      <div className="mb-2.5">
        <div>
          <div className="text-[12px] font-semibold text-gray-200">Environment</div>
          <div className="text-[11px] text-gray-500">Session overview</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <EnvironmentRow icon={<GitCompare className="h-3.5 w-3.5" />} label="Changes">
            {fileChanges && fileChanges.files.length > 0 ? (
              <span>
                {fileChanges.files.length} files
                <span className="ml-2 text-green-300">+{fileChanges.totalAdded}</span>
                <span className="ml-1 text-red-300">-{fileChanges.totalRemoved}</span>
              </span>
            ) : (
              <span className="text-gray-500">No file diffs</span>
            )}
          </EnvironmentRow>
          <EnvironmentRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="Local">
            <span className="truncate font-mono text-[11px] text-gray-300">
              {workspaceDir ? formatWorkspaceLabel(workspaceDir, 34) : "No workspace"}
            </span>
          </EnvironmentRow>
          {(gitBranch || workspaceDir) && (
            <EnvironmentRow icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch">
              <GitBranchSelector
                branches={gitBranches}
                changingBranch={gitBranchChanging}
                currentBranch={gitBranch}
                disabled={!workspaceDir}
                error={gitBranchError}
                loading={gitBranchLoading}
                onCheckout={onSwitchGitBranch}
                onCreate={onCreateGitBranch}
                onRefresh={onRefreshGitBranches}
              />
            </EnvironmentRow>
          )}
        </div>

        <EnvironmentSection title="Context and usage">
          <div className="space-y-2.5">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                <span className="text-gray-400">Active context</span>
                <span className="font-mono text-gray-300">
                  {contextUsage
                    ? `${formatCompactNumber(contextUsage.usedTokens)} / ${formatCompactNumber(contextUsage.limitTokens)}`
                    : "Not available"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[rgb(var(--accent-primary))] transition-[width] duration-300"
                  style={{ width: `${contextPercent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-gray-600">
                <span>{contextUsage ? `${contextPercent}% used` : "Waiting for context data"}</span>
                {contextUsage && (
                  <span>{formatCompactNumber(contextUsage.remainingTokens)} remaining</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-white/10 pt-2.5">
              <UsageStat
                description="Effective prompt tokens processed, including cached input when reported; estimated when a provider omits usage"
                label="Input"
                value={hasTokenUsage ? formatCompactNumber(tokenUsage?.inputTokens || 0) : "—"}
              />
              <UsageStat
                description="Generated tokens reported by the provider or estimated when usage is unavailable"
                label="Output"
                value={hasTokenUsage ? formatCompactNumber(tokenUsage?.outputTokens || 0) : "—"}
              />
              <UsageStat
                description="Provider requests made during this session"
                label="Model calls"
                value={hasTokenUsage ? formatCompactNumber(tokenUsage?.callCount || 0) : "—"}
              />
              <UsageStat
                description="Generated output tokens per second after the first streamed token"
                label="Output speed"
                value={
                  tokenUsage?.tokensPerSecond !== null && tokenUsage?.tokensPerSecond !== undefined
                    ? `${tokenUsage.tokensPerSecond} tok/s`
                    : "—"
                }
              />
              <UsageStat
                description="Measured time to first streamed token in the latest supported turn"
                label="First token"
                value={latestFirstTokenMs !== null ? formatLatency(latestFirstTokenMs) : "—"}
              />
              <UsageStat
                description="Input tokens served from the provider cache"
                label="Cache read"
                value={
                  hasTokenUsage
                    ? `${formatCompactNumber(tokenUsage?.cachedInputTokens || 0)}${tokenUsage?.cacheHitRate !== null && tokenUsage?.cacheHitRate !== undefined ? ` · ${tokenUsage.cacheHitRate}%` : ""}`
                    : "—"
                }
              />
              <UsageStat
                description="Input tokens written to the provider cache"
                label="Cache write"
                value={hasTokenUsage ? formatCompactNumber(tokenUsage?.cacheWriteTokens || 0) : "—"}
              />
              <UsageStat
                description="Earlier context reduced to preserve the active window"
                label="Compaction"
                value={
                  contextUsage?.compacted
                    ? `${contextUsage.compactionCount || 0}x · ${formatCompactNumber(contextUsage.compactedTokens || 0)}`
                    : "Never"
                }
              />
            </div>
          </div>
        </EnvironmentSection>

        <EnvironmentSection title="Plans">
          {currentPlan ? (
            <PlanSummaryCard
              plan={currentPlan}
              expandable
              dismissible
              onDismiss={onDismissPlan}
              title="Latest plan update"
            />
          ) : (
            <div className="rounded-lg border border-[#343843] bg-[#171a22] p-2 text-[12px] text-gray-500">
              No plan has been recorded for this chat.
            </div>
          )}
        </EnvironmentSection>

        <EnvironmentSection title="Subagents">
          {subagents.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5">
              {subagents.slice(0, 6).map((subagent) => (
                <div
                  key={subagent.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-[12px]"
                >
                  <span className="truncate text-gray-300">{subagent.label}</span>
                  <span className="shrink-0 text-[10px] capitalize text-gray-500">
                    {subagent.status}
                  </span>
                </div>
              ))}
              {subagents.length > 6 && (
                <div className="px-1 text-[11px] text-gray-600">
                  Show {subagents.length - 6} more in Subagents
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-gray-500">No active subagents</div>
          )}
        </EnvironmentSection>

        {(previewTabs.length > 0 || agentUsingBrowser) && (
          <EnvironmentSection title="Preview">
            {agentUsingBrowser && (
              <button
                type="button"
                className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-[rgba(var(--accent-primary),0.3)] bg-[rgba(var(--accent-primary),0.1)] px-2.5 py-2 text-left text-[12px] text-gray-200 hover:bg-[rgba(var(--accent-primary),0.16)]"
                onClick={() => {
                  onOpenWorkspaceTab("browser");
                }}
              >
                <Globe2 className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--accent-primary))]" />
                <span className="min-w-0 flex-1 truncate">Agent is browsing</span>
                <span className="shrink-0 text-[10px] text-gray-500">Open browser</span>
              </button>
            )}
            {previewTabs.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {previewTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className="rounded-md bg-white/[0.04] px-2 py-1.5 text-left text-[11px] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200"
                    onClick={() => {
                      onOpenWorkspaceTab(tab);
                    }}
                  >
                    {chatWorkspaceTabLabel(tab)}
                  </button>
                ))}
              </div>
            )}
          </EnvironmentSection>
        )}

        <EnvironmentSection title="Sources">
          {toolNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {toolNames.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-[#343843] bg-[#171a22] px-2 py-1 text-[11px] text-gray-400"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-gray-500">No tool sources yet</div>
          )}
        </EnvironmentSection>
      </div>
    </div>
  );

  if (typeof document === "undefined") return panel;
  return createPortal(panel, document.body);
}
