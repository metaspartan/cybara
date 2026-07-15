import { Folder, Loader2 } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

interface ChatEmptyStateProps {
  children: ReactNode;
  onSelectWorkspace: () => void;
  workspaceDir: string;
  workspaceSaving: boolean;
}

export function ChatEmptyState({
  children,
  onSelectWorkspace,
  workspaceDir,
  workspaceSaving,
}: ChatEmptyStateProps): ReactElement {
  return (
    <div
      data-chat-empty-state="true"
      className="mx-auto flex w-full max-w-[42rem] -translate-y-[3vh] flex-col items-center px-1"
    >
      <div className="text-center text-gray-500">
        <img
          src="/cybara.png"
          alt=""
          aria-hidden="true"
          className="mx-auto mb-4 h-16 w-16 object-contain opacity-40 grayscale brightness-[1.7] contrast-150"
        />
        <p className="text-sm font-medium">Start a conversation</p>
        <p className="mt-1 text-[12px] text-gray-600">
          Ask questions, get help with code, or chat with your agents
        </p>
        <button
          type="button"
          onClick={onSelectWorkspace}
          disabled={workspaceSaving}
          className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-[rgba(var(--accent-primary),0.32)] bg-[rgba(var(--accent-primary),0.1)] px-2.5 py-1.5 text-[rgb(var(--accent-primary))] transition-colors hover:bg-[rgba(var(--accent-primary),0.16)] disabled:cursor-not-allowed disabled:opacity-60"
          title={
            workspaceDir ? "Click to change workspace" : "Select workspace folder for this session"
          }
        >
          {workspaceSaving ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate font-mono text-[12px]">
            {workspaceDir ? `Workspace: ${workspaceDir}` : "Select workspace"}
          </span>
        </button>
      </div>
      <div className="mt-4 w-full text-left">{children}</div>
    </div>
  );
}
