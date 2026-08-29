import { ChevronRight, FolderOpen, Loader2, X } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { GitBranchSelector, type GitBranchOption } from "./GitBranchSelector";

export function workspaceFolderName(path: string): string {
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
  className,
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
  className?: string;
  workspaceDir: string | null;
  workspaceSaving: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "new-chat-workspace-bar mx-3 mb-2 flex min-h-11 min-w-0 items-center gap-1.5 rounded-2xl border p-1.5 text-[12px] shadow-sm",
        className
      )}
    >
      <button
        type="button"
        onClick={onSelectWorkspace}
        disabled={workspaceSaving}
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        title={workspaceDir || "Select workspace"}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(var(--accent-primary),0.22)] bg-[rgba(var(--accent-primary),0.1)] text-[rgb(var(--accent-primary))] transition-colors group-hover:bg-[rgba(var(--accent-primary),0.16)]">
          {workspaceSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-4 text-[var(--text-primary)]">
            {workspaceDir ? workspaceFolderName(workspaceDir) : "Select workspace"}
          </span>
          <span className="block truncate text-[10px] leading-3.5 text-[var(--text-muted)]">
            {workspaceDir ? "Project context is active" : "Choose a project folder for this chat"}
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]" />
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
      {workspaceDir ? (
        <button
          type="button"
          onClick={onClearWorkspace}
          disabled={workspaceSaving}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--icon-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          title="Clear workspace"
          aria-label="Clear workspace"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      ) : null}
    </div>
  );
}
