import { Folder, Loader2 } from "lucide-react";
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
  onRefreshBranches: () => Promise<void> | void;
  onSelectWorkspace: () => void;
  onSwitchBranch: (branch: string) => Promise<void> | void;
  workspaceDir: string;
  workspaceSaving: boolean;
}): ReactElement {
  return (
    <div className="new-chat-workspace-bar mx-4 flex h-10 min-w-0 items-center gap-2 rounded-t-[18px] border border-b-0 px-3 pb-1 text-[12px]">
      <button
        type="button"
        onClick={onSelectWorkspace}
        disabled={workspaceSaving}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] leading-4 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
