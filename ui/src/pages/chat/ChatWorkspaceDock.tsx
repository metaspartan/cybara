import type { MouseEvent, ReactElement } from "react";
import { EmbeddedTerminalPanel } from "@/components/ide/EmbeddedTerminalPanel";
import { cn } from "@/lib/utils";
import { ChatWorkspaceBrowser } from "./ChatWorkspaceBrowser";
import { ChatWorkspaceComputer } from "./ChatWorkspaceComputer";
import { ChatWorkspaceFiles } from "./ChatWorkspaceFiles";
import { ChatWorkspaceSimulator } from "./ChatWorkspaceSimulator";
import {
  ChatWorkspacePanel,
  type ChatWorkspaceTab,
  type WorkspaceTabInstance,
} from "./ChatWorkspacePanel";
import type { FileChangeItem, FileChangeSummary } from "./chatModel";
import type { ChatLinkOpenOptions } from "./chatLinkRouting";
import { SessionDiffPanel } from "./SessionDiffPanel";
import { SubagentPanel } from "./SubagentPanel";
import { SubagentDetailPanel } from "./SubagentDetailPanel";

interface ChatWorkspaceDockProps {
  activeTab: string | null;
  agentId?: string;
  diffError: string | null;
  diffLoading: boolean;
  diffSummary: FileChangeSummary | null;
  isOpen: boolean;
  selectedDiffPath: string | null;
  sessionId: string | null;
  tabs: WorkspaceTabInstance[];
  width: number;
  workspaceDir: string | null;
  onClose: () => void;
  onCloseTab: (id: string) => void;
  onOpenDiffInWorkspace: (file: FileChangeItem) => void;
  onOpenFullIde: (path: string) => void;
  onOpenLink: (href: string, options: ChatLinkOpenOptions) => boolean;
  onOpenTab: (kind: ChatWorkspaceTab) => void;
  onOpenSubagent: (runId: string, title: string) => void;
  onRefreshDiff: () => void;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onSelectDiffPath: (path: string | null) => void;
  onSelectTab: (id: string) => void;
  onUpdateTabTitle: (id: string, title: string) => void;
  onViewSubagentSession: (sessionKey: string) => void;
}

export function ChatWorkspaceDock({
  activeTab,
  agentId,
  diffError,
  diffLoading,
  diffSummary,
  isOpen,
  selectedDiffPath,
  sessionId,
  tabs,
  width,
  workspaceDir,
  onClose,
  onCloseTab,
  onOpenDiffInWorkspace,
  onOpenFullIde,
  onOpenLink,
  onOpenTab,
  onOpenSubagent,
  onRefreshDiff,
  onResizeStart,
  onSelectDiffPath,
  onSelectTab,
  onUpdateTabTitle,
  onViewSubagentSession,
}: ChatWorkspaceDockProps): ReactElement {
  return (
    <ChatWorkspacePanel
      activeTab={activeTab}
      isOpen={isOpen}
      tabs={tabs}
      width={width}
      onClose={onClose}
      onCloseTab={onCloseTab}
      onOpenTab={onOpenTab}
      onResizeStart={onResizeStart}
      onSelectTab={onSelectTab}
    >
      {tabs.map((instance) => {
        const active = activeTab === instance.id;
        const hiddenClass = cn("h-full", !active && "hidden");
        if (instance.kind === "review") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <SessionDiffPanel
                embedded
                isOpen={active}
                summary={diffSummary}
                selectedPath={selectedDiffPath}
                onSelectPath={onSelectDiffPath}
                onClose={() => onCloseTab(instance.id)}
                width={width}
                onResizeStart={onResizeStart}
                onOpenInIDE={onOpenDiffInWorkspace}
                workspaceDir={workspaceDir}
                loading={diffLoading}
                error={diffError}
                onRetry={onRefreshDiff}
              />
            </div>
          );
        }
        if (instance.kind === "terminal") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <EmbeddedTerminalPanel
                workspacePath={workspaceDir || "~"}
                visible={isOpen && active}
                createRequestToken={0}
                autoCreateOnVisible
                singleSession
              />
            </div>
          );
        }
        if (instance.kind === "browser") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <ChatWorkspaceBrowser
                key={`${instance.id}:${sessionId || "new-chat"}`}
                visible={isOpen && active}
                sessionId={sessionId}
                pageKey={instance.pageKey}
                navigationRequest={instance.navigationRequest}
                navigationUrl={instance.navigationUrl}
                onTitleChange={(title) => onUpdateTabTitle(instance.id, title)}
              />
            </div>
          );
        }
        if (instance.kind === "files") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <ChatWorkspaceFiles
                workspaceDir={workspaceDir}
                initialPath={instance.pageKey}
                onOpenFullIde={onOpenFullIde}
              />
            </div>
          );
        }
        if (instance.kind === "ios" || instance.kind === "android") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <ChatWorkspaceSimulator
                platform={instance.kind}
                sessionId={sessionId}
                visible={isOpen && active}
              />
            </div>
          );
        }
        if (instance.kind === "computer") {
          return (
            <div key={instance.id} className={hiddenClass}>
              <ChatWorkspaceComputer sessionId={sessionId} visible={isOpen && active} />
            </div>
          );
        }
        if (instance.pageKey) {
          return (
            <div key={instance.id} className={hiddenClass}>
              <SubagentDetailPanel
                runId={instance.pageKey}
                onClear={() => onCloseTab(instance.id)}
                onOpenLink={onOpenLink}
                onViewSession={onViewSubagentSession}
              />
            </div>
          );
        }
        return (
          <div key={instance.id} className={hiddenClass}>
            <SubagentPanel
              embedded
              agentId={agentId}
              isOpen={active}
              onClose={() => onCloseTab(instance.id)}
              sessionId={sessionId}
              workspaceDir={workspaceDir}
              onOpenSubagent={onOpenSubagent}
            />
          </div>
        );
      })}
    </ChatWorkspacePanel>
  );
}
