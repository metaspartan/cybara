import { useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import {
  FileText,
  FolderTree,
  Globe2,
  PanelRightClose,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SubagentIcon } from "./SubagentIcon";

export type ChatWorkspaceTab = "review" | "terminal" | "browser" | "files" | "subagents";

const TAB_DETAILS: Record<
  ChatWorkspaceTab,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  review: { label: "Review", icon: FileText },
  terminal: { label: "Terminal", icon: SquareTerminal },
  browser: { label: "Browser", icon: Globe2 },
  files: { label: "Files", icon: FolderTree },
  subagents: { label: "Side task", icon: SubagentIcon },
};

export function chatWorkspaceTabLabel(tab: ChatWorkspaceTab): string {
  return TAB_DETAILS[tab].label;
}

export function ChatWorkspacePanel({
  activeTab,
  children,
  isOpen,
  onClose,
  onCloseTab,
  onOpenTab,
  onResizeStart,
  onSelectTab,
  tabLabels,
  tabs,
  width,
}: {
  activeTab: ChatWorkspaceTab | null;
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onCloseTab: (tab: ChatWorkspaceTab) => void;
  onOpenTab: (tab: ChatWorkspaceTab) => void;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onSelectTab: (tab: ChatWorkspaceTab) => void;
  tabLabels?: Partial<Record<ChatWorkspaceTab, string>>;
  tabs: ChatWorkspaceTab[];
  width: number;
}) {
  const [showToolMenu, setShowToolMenu] = useState(false);

  return (
    <aside
      aria-hidden={!isOpen}
      className={cn(
        "relative min-w-0 shrink-0 flex-col border-l border-white/10 bg-[var(--chat-environment-panel-bg)]",
        isOpen ? "flex" : "hidden"
      )}
      data-testid="chat-workspace-panel"
      style={{ width }}
    >
      <div
        aria-label="Resize workspace panel"
        aria-orientation="vertical"
        className="group absolute -left-1 top-0 z-40 h-full w-2 cursor-col-resize touch-none"
        onMouseDown={onResizeStart}
        role="separator"
        tabIndex={0}
      >
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10 transition-colors group-hover:bg-[rgba(var(--accent-primary),0.7)] group-focus-visible:bg-[rgba(var(--accent-primary),0.7)]" />
      </div>

      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 px-2">
        <div className="flex min-w-0 max-w-[calc(100%-68px)] items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const details = TAB_DETAILS[tab];
            const Icon = details.icon;
            const label = tabLabels?.[tab]?.trim() || details.label;
            return (
              <div
                key={tab}
                className={cn(
                  "group flex h-8 shrink-0 items-center rounded-md text-[11px] transition-colors",
                  activeTab === tab
                    ? "bg-white/[0.08] text-gray-100"
                    : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                )}
              >
                <button
                  type="button"
                  className="flex h-full items-center gap-1.5 pl-2 pr-1"
                  onClick={() => onSelectTab(tab)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="max-w-32 truncate">{label}</span>
                </button>
                <button
                  type="button"
                  className="mr-1 rounded p-1 text-gray-600 opacity-0 transition-opacity hover:bg-white/10 hover:text-gray-300 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => onCloseTab(tab)}
                  aria-label={`Close ${details.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div
          data-chat-workspace-header-slot=""
          className="flex min-w-0 shrink items-center gap-1 overflow-x-auto empty:hidden"
        />
        <div className="relative">
          <button
            type="button"
            aria-expanded={showToolMenu}
            aria-haspopup="menu"
            aria-label="Add workspace tool"
            className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
            onClick={() => setShowToolMenu((value) => !value)}
            title="Add workspace tool"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {showToolMenu && (
            <div
              role="menu"
              className="absolute right-0 top-9 z-50 w-44 rounded-md border border-white/10 bg-[var(--chat-environment-panel-bg)] p-1.5 shadow-2xl"
            >
              {(Object.keys(TAB_DETAILS) as ChatWorkspaceTab[]).map((tab) => {
                const details = TAB_DETAILS[tab];
                const Icon = details.icon;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="menuitem"
                    className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-[12px] text-gray-300 hover:bg-white/[0.07] hover:text-white"
                    onClick={() => {
                      onOpenTab(tab);
                      setShowToolMenu(false);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 text-gray-500" />
                    <span>{details.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
          onClick={onClose}
          title="Close workspace panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          children
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-[540px] space-y-1.5">
              {(Object.keys(TAB_DETAILS) as ChatWorkspaceTab[]).map((tab) => {
                const details = TAB_DETAILS[tab];
                const Icon = details.icon;
                return (
                  <button
                    key={tab}
                    type="button"
                    className="flex h-10 w-full items-center gap-2 rounded-md bg-white/[0.045] px-3 text-left text-[12px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                    onClick={() => onOpenTab(tab)}
                  >
                    <Icon className="h-3.5 w-3.5 text-gray-500" />
                    <span>{details.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
