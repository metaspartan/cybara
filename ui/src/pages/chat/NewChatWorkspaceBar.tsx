import { Folder, Loader2, X } from "lucide-react";
import type { ReactElement } from "react";
import { GitBranchSelector, type GitBranchOption } from "./GitBranchSelector";

function workspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

export function NewChatWorkspaceBar({
  branches,
  changingBranch,
  currentBranch,
  error,
  loading,
  onCreateBranch,
  onClearWorkspace,
  onRefreshBranches,
  onSelectWorkspace,
  onSwitchBranch,
  workspaceDir,
  workspaceSaving,
}: {
  branches: GitBranchOption[];
  changingBranch: string | null;
  currentBranch: string | null;
  error: string | null;
  loading: boolean;
  onCreateBranch: (branch: string) => Promise<void> | void;
  onClearWorkspace: () => void;
  onRefreshBranches: () => Promise<void> | void;
  onSelectWorkspace: () => void;
  onSwitchBranch: (branch: string) => Promise<void> | void;
  workspaceDir: string | null;
  workspaceSaving: boolean;
}): ReactElement {
  return (
    <div className="new-chat-workspace-bar mx-4 flex h-9 min-w-0 items-center gap-1 rounded-t-[18px] border border-b-0 px-3 text-[12px]">
      {workspaceDir ? (
        <button
          type="button"
          onClick={onClearWorkspace}
          disabled={workspaceSaving}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--icon-muted)] text-[var(--surface-panel)] transition-colors hover:bg-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          title="Clear workspace"
          aria-label="Clear workspace"
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSelectWorkspace}
        disabled={workspaceSaving}
        className={`flex min-w-0 items-center gap-1.5 rounded-md py-1 text-[12px] leading-4 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60 ${workspaceDir ? "pl-0.5 pr-1.5" : "px-1.5"}`}
        title={workspaceDir || "Select workspace"}
      >
        {workspaceSaving ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
        )}
        <span className="max-w-48 truncate">
          {workspaceDir ? workspaceName(workspaceDir) : "Select workspace"}
        </span>
      </button>
      {workspaceDir ? (
        <GitBranchSelector
          appearance="inline"
          branches={branches}
          changingBranch={changingBranch}
          currentBranch={currentBranch}
          error={error}
          loading={loading}
          onCheckout={onSwitchBranch}
          onCreate={onCreateBranch}
          onRefresh={onRefreshBranches}
        />
      ) : null}
    </div>
  );
}
