import { FileText, LayoutGrid, PanelRightOpen, Share2, SlidersHorizontal } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";
import { ChatEnvironmentOverview } from "./ChatEnvironmentOverview";
import { ChatHeaderTitleMenu } from "./ChatHeaderTitleMenu";
import { SubagentIcon } from "./SubagentIcon";
import { WorkspaceOpenMenu } from "./WorkspaceOpenMenu";

interface ChatPageHeaderProps {
  environmentKey: string;
  environmentOverview: ComponentProps<typeof ChatEnvironmentOverview>;
  fileReviewActive: boolean;
  nearbyEnabled: boolean;
  sessionTitle: ComponentProps<typeof ChatHeaderTitleMenu>;
  workspaceMenu: ComponentProps<typeof WorkspaceOpenMenu>;
  workspacePanelOpen: boolean;
  subagentsActive: boolean;
  onOpenNearbyShare: () => void;
  onOpenMultiChat: () => void;
  onToggleEnvironment: () => void;
  onToggleFileReview: () => void;
  onToggleSubagents: () => void;
  onToggleWorkspacePanel: () => void;
}

export function ChatPageHeader({
  environmentKey,
  environmentOverview,
  fileReviewActive,
  nearbyEnabled,
  sessionTitle,
  workspaceMenu,
  workspacePanelOpen,
  subagentsActive,
  onOpenNearbyShare,
  onOpenMultiChat,
  onToggleEnvironment,
  onToggleFileReview,
  onToggleSubagents,
  onToggleWorkspacePanel,
}: ChatPageHeaderProps): ReactElement {
  return (
    <div className="relative flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl flex-shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <ChatHeaderTitleMenu {...sessionTitle} />
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <WorkspaceOpenMenu {...workspaceMenu} />
        <button
          type="button"
          aria-label="Open multi-chat"
          onClick={onOpenMultiChat}
          className="theme-muted-icon-button relative cursor-pointer rounded-lg p-1.5 transition-colors sm:p-2"
          title="Open multi-chat"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        {nearbyEnabled ? (
          <button
            type="button"
            aria-label="Send chat to nearby Cybara"
            onClick={onOpenNearbyShare}
            className="relative cursor-pointer rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 sm:p-2"
            title="Send to nearby Cybara"
          >
            <Share2 className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="File diffs"
          onClick={onToggleFileReview}
          className={cn(
            "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
            fileReviewActive ? "text-indigo-300 bg-white/[0.04]" : "text-gray-500"
          )}
          title="File diffs"
        >
          <FileText className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-label="Environment overview"
          onClick={onToggleEnvironment}
          className={cn(
            "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
            environmentOverview.isOpen ? "text-gray-200 bg-white/[0.04]" : "text-gray-500"
          )}
          title="Environment overview"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onToggleSubagents}
          className={cn(
            "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
            subagentsActive ? "text-gray-200 bg-white/[0.04]" : "text-gray-500"
          )}
          title="Subagents"
        >
          <SubagentIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleWorkspacePanel}
          className={cn(
            "p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
            workspacePanelOpen ? "text-gray-200 bg-white/[0.04]" : "text-gray-500"
          )}
          title="Workspace panel"
          aria-label="Workspace panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <ChatEnvironmentOverview key={environmentKey} {...environmentOverview} />
      </div>
    </div>
  );
}
