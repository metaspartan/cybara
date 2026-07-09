import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, GitBranch, GitCompare, Gauge, X } from "lucide-react";
import type { Subagent } from "@/hooks/useApi";
import type { SessionContextUsage, SessionTokenUsage } from "@/types";
import { formatWorkspaceLabel, type FileChangeSummary, type SessionPlanView } from "./chatModel";
import { GitBranchSelector, type GitBranchOption } from "./GitBranchSelector";
import { PlanSummaryCard } from "./PlanSummaryCard";

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
  onClose,
  onCreateGitBranch,
  onRefreshGitBranches,
  onSwitchGitBranch,
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
  onClose: () => void;
  onCreateGitBranch: (branch: string) => Promise<void> | void;
  onRefreshGitBranches: () => Promise<void> | void;
  onSwitchGitBranch: (branch: string) => Promise<void> | void;
  sessionId: string | null;
  subagents: Subagent[];
  tokenUsage: SessionTokenUsage | null;
  toolNames: string[];
  workspaceDir: string | null;
}) {
  if (!isOpen) return null;

  const panel = (
    <div
      className="chat-environment-panel fixed right-3 top-[52px] z-[2147483000] max-h-[calc(100vh-68px)] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border p-3 text-sm shadow-[0_28px_90px_rgba(0,0,0,0.92)]"
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
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-gray-200">Environment</div>
          <div className="text-[11px] text-gray-500">Current chat only</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-[#242733] hover:text-gray-200"
          title="Close environment overview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
          <EnvironmentRow icon={<Gauge className="h-3.5 w-3.5" />} label="Tokens">
            {tokenUsage && tokenUsage.totalTokens > 0 ? (
              <span className="text-gray-300">
                {formatCompactNumber(tokenUsage.inputTokens)} in /{" "}
                {formatCompactNumber(tokenUsage.outputTokens)} out
              </span>
            ) : (
              <span className="text-gray-500">No usage recorded</span>
            )}
          </EnvironmentRow>
          {tokenUsage && tokenUsage.totalTokens > 0 && (
            <EnvironmentRow icon={<Gauge className="h-3.5 w-3.5" />} label="Speed">
              <span className="text-gray-300">
                {tokenUsage.tokensPerSecond !== null
                  ? `${tokenUsage.tokensPerSecond} tok/s`
                  : "No duration sample"}
                <span className="ml-2 text-gray-500">{tokenUsage.callCount} calls</span>
              </span>
            </EnvironmentRow>
          )}
          {contextUsage?.compacted && (
            <EnvironmentRow icon={<Gauge className="h-3.5 w-3.5" />} label="Compact">
              <span className="text-gray-300">
                {contextUsage.compactionCount || 0}x
                {(contextUsage.compactedTokens || 0) > 0 && (
                  <span className="ml-2 text-gray-500">
                    {formatCompactNumber(contextUsage.compactedTokens || 0)} summarized
                  </span>
                )}
              </span>
            </EnvironmentRow>
          )}
        </div>

        <EnvironmentSection title="Plans">
          {currentPlan ? (
            <PlanSummaryCard plan={currentPlan} expandable title="Latest plan update" />
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
