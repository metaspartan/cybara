import { useState, type ReactElement, type ReactNode } from "react";
import type { BotRosterItem } from "@/types";
import { BotAvatar } from "./BotAvatar";
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
  goalPanel?: ReactNode;
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
  bot?: BotRosterItem | null;
}

export function ChatEmptyState({
  goalPanel,
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
  bot,
}: ChatEmptyStateProps): ReactElement {
  const [emptyWorkspacePrompt] = useState(randomEmptyWorkspacePrompt);
  const workspaceName = workspaceDir ? workspaceFolderName(workspaceDir) : null;
  const routineCount = bot?.routine_count ?? 0;
  const activeRoutineCount = bot?.active_routine_count ?? 0;
  const mentionHandle =
    bot?.mention_handle ??
    bot?.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return (
    <div data-chat-empty-state="true" className="flex w-full flex-col items-center">
      <div className="mx-auto flex w-[min(100%,40rem)] -translate-y-[3vh] flex-col items-center">
        <div className="text-center">
          {bot ? (
            <BotAvatar
              bot={bot}
              className="mx-auto mb-4 h-20 w-20 rounded-[26px] text-xl shadow-[0_18px_50px_rgba(0,0,0,0.32)]"
              showPresence={false}
            />
          ) : (
            <span className="chat-empty-state-logo mx-auto mb-4 block h-16 w-16" aria-hidden="true">
              <img src="/cybara.png" alt="" className="h-full w-full object-contain" />
            </span>
          )}
          <p className="text-xl font-medium text-[var(--text-primary)]">
            {bot ? (
              <>
                Message <span className="font-semibold">{bot.name}</span> like a teammate
              </>
            ) : workspaceName ? (
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
          {bot ? (
            <div className="mx-auto mt-2 max-w-lg">
              <p className="text-sm font-medium text-[var(--text-secondary)]">{bot.title}</p>
              {bot.description ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  {bot.description}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[10px] font-medium text-[var(--text-muted)]">
                <span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1">
                  {bot.memory_enabled !== false ? "Persistent memory" : "Session memory"}
                </span>
                <span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1">
                  {routineCount > 0
                    ? `${activeRoutineCount} active · ${routineCount} routine${routineCount === 1 ? "" : "s"}`
                    : "Background work ready"}
                </span>
                <span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1">
                  @{mentionHandle}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
              Ask questions, get help with code, or chat with your agents
            </p>
          )}
        </div>
        <div className="mx-auto mt-4 w-full text-left">
          {goalPanel}
          <NewChatWorkspaceBar
            appearance={bot ? "bot" : "session"}
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
    </div>
  );
}
