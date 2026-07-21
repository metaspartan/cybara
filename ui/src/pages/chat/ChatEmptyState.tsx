import type { ReactElement, ReactNode } from "react";
import type { GitBranchOption } from "./GitBranchSelector";
import { NewChatWorkspaceBar } from "./NewChatWorkspaceBar";

interface ChatEmptyStateProps {
  children: ReactNode;
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
  children,
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
  return (
    <div
      data-chat-empty-state="true"
      className="mx-auto flex w-full max-w-[42rem] -translate-y-[3vh] flex-col items-center px-1"
    >
      <div className="text-center text-gray-500">
        <span className="chat-empty-state-logo mx-auto mb-4 block h-16 w-16" aria-hidden="true">
          <img src="/cybara.png" alt="" className="h-full w-full object-contain" />
        </span>
        <p className="text-sm font-medium">Start a conversation</p>
        <p className="mt-1 text-[12px] text-gray-600">
          Ask questions, get help with code, or chat with your agents
        </p>
      </div>
      <div className="mt-4 w-full text-left">
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
        {children}
      </div>
    </div>
  );
}
