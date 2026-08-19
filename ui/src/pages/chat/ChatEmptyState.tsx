import { useState, type ReactElement } from "react";
import type { GitBranchOption } from "./GitBranchSelector";
import { NewChatWorkspaceBar, workspaceFolderName } from "./NewChatWorkspaceBar";

export const EMPTY_WORKSPACE_PROMPTS = [
  "What should we build?",
  "Hello, what would you like to do?",
  "What would you like to work on?",
] as const;

function randomEmptyWorkspacePrompt(): (typeof EMPTY_WORKSPACE_PROMPTS)[number] {
  return (
    EMPTY_WORKSPACE_PROMPTS[Math.floor(Math.random() * EMPTY_WORKSPACE_PROMPTS.length)] ||
    EMPTY_WORKSPACE_PROMPTS[0]
  );
}

interface ChatEmptyStateProps {
  onClearWorkspace: () => void;
  onSelectWorkspace: () => void;
  workspaceDir: string | null;
  workspaceSaving: boolean;
  gitBranches: GitBranchOption[];
  gitBranch: string | null;
  gitBranchChanging: string | null;
  gitBranchError: string | null;
  gitBranchLoading: boolean;
  onCreateGitBranch: (branch: string) => Promise<void> | void;
  onRefreshGitBranches: () => Promise<void> | void;
  onSwitchGitBranch: (branch: string) => Promise<void> | void;
}

export function ChatEmptyState({
  onClearWorkspace,
  onSelectWorkspace,
  workspaceDir,
  workspaceSaving,
  gitBranches,
  gitBranch,
  gitBranchChanging,
  gitBranchError,
  gitBranchLoading,
  onCreateGitBranch,
  onRefreshGitBranches,
  onSwitchGitBranch,
}: ChatEmptyStateProps): ReactElement {
  const [emptyWorkspacePrompt] = useState(randomEmptyWorkspacePrompt);
  const workspaceName = workspaceDir ? workspaceFolderName(workspaceDir) : null;

  return (
    <div
      data-chat-empty-state="true"
      className="mx-auto flex w-[min(100%,40rem)] -translate-y-[3vh] flex-col items-center"
    >
      <div className="text-center">
        <span className="chat-empty-state-logo mx-auto mb-4 block h-16 w-16" aria-hidden="true">
          <img src="/cybara.png" alt="" className="h-full w-full object-contain" />
        </span>
        <p className="text-xl font-medium text-[var(--text-primary)]">
          {workspaceName ? (
            <>
              What should we build in{" "}
              <button
                type="button"
                onClick={onSelectWorkspace}
                disabled={workspaceSaving}
                className="rounded-sm font-semibold text-[var(--text-primary)] underline decoration-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[rgb(var(--accent-primary))] disabled:cursor-not-allowed disabled:opacity-60"
                title={workspaceDir || undefined}
                aria-label={`Change workspace from ${workspaceName}`}
              >
                {workspaceName}
              </button>
              ?
            </>
          ) : (
            emptyWorkspacePrompt
          )}
        </p>
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Ask questions, get help with code, or chat with your agents
        </p>
      </div>
      <div className="mx-auto mt-4 w-full text-left">
        <NewChatWorkspaceBar
          branches={gitBranches}
          changingBranch={gitBranchChanging}
          currentBranch={gitBranch}
          error={gitBranchError}
          loading={gitBranchLoading}
          onCreateBranch={onCreateGitBranch}
          onClearWorkspace={onClearWorkspace}
          onRefreshBranches={onRefreshGitBranches}
          onSelectWorkspace={onSelectWorkspace}
          onSwitchBranch={onSwitchGitBranch}
          workspaceDir={workspaceDir}
          workspaceSaving={workspaceSaving}
        />
      </div>
    </div>
  );
}
