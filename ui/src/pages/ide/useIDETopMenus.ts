import { type Dispatch, type RefObject, type SetStateAction, useMemo } from "react";
import type { IdeSettingsSectionId, IdeTopMenuId } from "./ideTypes";

interface IdeTopMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  dividerAbove?: boolean;
  run: () => void;
}

export interface IdeTopMenu {
  id: IdeTopMenuId;
  label: string;
  widthClassName?: string;
  items: IdeTopMenuItem[];
}

interface UseIDETopMenusOptions {
  currentPath: string;
  workspacePath?: string;
  isIdeChatOpen: boolean;
  isTerminalPanelOpen: boolean;
  setSaveRequestToken: Dispatch<SetStateAction<number>>;
  setCreateParentPath: Dispatch<SetStateAction<string | null>>;
  setCreateType: Dispatch<SetStateAction<"file" | "directory" | null>>;
  handlePromptOpenWorkspace: () => Promise<void>;
  handleRefresh: () => void;
  openIdeSettings: (section?: IdeSettingsSectionId) => void;
  openCommandPalette: () => void;
  openQuickOpenPalette: () => void;
  openGlobalSearchPanel: () => void;
  setSidebarMode: Dispatch<SetStateAction<"explorer" | "search" | "outline">>;
  outlineInputRef: RefObject<HTMLInputElement | null>;
  setIsIdeChatOpen: Dispatch<SetStateAction<boolean>>;
  toggleTerminalPanel: () => void;
  openNewTerminal: () => void;
  handleCycleTabs: (direction: 1 | -1) => void;
  handleGoHome: () => void;
}

export function useIDETopMenus({
  currentPath,
  workspacePath,
  isIdeChatOpen,
  isTerminalPanelOpen,
  setSaveRequestToken,
  setCreateParentPath,
  setCreateType,
  handlePromptOpenWorkspace,
  handleRefresh,
  openIdeSettings,
  openCommandPalette,
  openQuickOpenPalette,
  openGlobalSearchPanel,
  setSidebarMode,
  outlineInputRef,
  setIsIdeChatOpen,
  toggleTerminalPanel,
  openNewTerminal,
  handleCycleTabs,
  handleGoHome,
}: UseIDETopMenusOptions): IdeTopMenu[] {
  return useMemo(
    () => [
      {
        id: "file",
        label: "File",
        widthClassName: "w-72",
        items: [
          {
            id: "save",
            label: "Save",
            shortcut: "Ctrl/Cmd+S",
            run: () => setSaveRequestToken((previous) => previous + 1),
          },
          {
            id: "new-file",
            label: "New File",
            shortcut: "Ctrl/Cmd+N",
            dividerAbove: true,
            run: () => {
              setCreateParentPath(workspacePath || currentPath);
              setCreateType("file");
            },
          },
          {
            id: "new-folder",
            label: "New Folder",
            shortcut: "Ctrl/Cmd+Shift+N",
            run: () => {
              setCreateParentPath(workspacePath || currentPath);
              setCreateType("directory");
            },
          },
          {
            id: "open-workspace",
            label: "Open Workspace Folder",
            shortcut: "Ctrl/Cmd+O",
            run: () => void handlePromptOpenWorkspace(),
          },
          {
            id: "refresh-workspace",
            label: "Refresh Workspace",
            dividerAbove: true,
            run: handleRefresh,
          },
          {
            id: "ide-settings",
            label: "IDE Settings",
            shortcut: "Ctrl/Cmd+,",
            run: () => openIdeSettings("general"),
          },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        widthClassName: "w-72",
        items: [
          {
            id: "command-palette",
            label: "Command Palette",
            shortcut: "Ctrl/Cmd+Shift+P",
            run: openCommandPalette,
          },
          {
            id: "quick-open",
            label: "Quick Open",
            shortcut: "Ctrl/Cmd+P",
            run: openQuickOpenPalette,
          },
          {
            id: "global-search",
            label: "Search in Workspace",
            shortcut: "Ctrl/Cmd+Shift+F",
            dividerAbove: true,
            run: openGlobalSearchPanel,
          },
        ],
      },
      {
        id: "view",
        label: "View",
        widthClassName: "w-72",
        items: [
          {
            id: "show-explorer",
            label: "Show Explorer",
            shortcut: "Ctrl/Cmd+Shift+E",
            run: () => setSidebarMode("explorer"),
          },
          {
            id: "show-search",
            label: "Show Search",
            shortcut: "Ctrl/Cmd+Shift+F",
            run: openGlobalSearchPanel,
          },
          {
            id: "show-outline",
            label: "Show Outline",
            shortcut: "Ctrl/Cmd+Shift+O",
            run: () => {
              setSidebarMode("outline");
              window.requestAnimationFrame(() => {
                outlineInputRef.current?.focus();
                outlineInputRef.current?.select();
              });
            },
          },
          {
            id: "toggle-chat",
            label: isIdeChatOpen ? "Hide IDE Chat" : "Show IDE Chat",
            shortcut: "Ctrl/Cmd+\\",
            dividerAbove: true,
            run: () => setIsIdeChatOpen((previous) => !previous),
          },
        ],
      },
      {
        id: "terminal",
        label: "Terminal",
        widthClassName: "w-72",
        items: [
          {
            id: "toggle-terminal",
            label: isTerminalPanelOpen ? "Hide Terminal Panel" : "Show Terminal Panel",
            shortcut: "Ctrl/Cmd+`",
            run: toggleTerminalPanel,
          },
          {
            id: "new-terminal",
            label: "New Terminal",
            shortcut: "Ctrl/Cmd+Shift+`",
            run: openNewTerminal,
          },
        ],
      },
      {
        id: "go",
        label: "Go",
        widthClassName: "w-72",
        items: [
          {
            id: "next-tab",
            label: "Next Tab",
            shortcut: "Ctrl/Cmd+Tab",
            run: () => handleCycleTabs(1),
          },
          {
            id: "previous-tab",
            label: "Previous Tab",
            shortcut: "Ctrl/Cmd+Shift+Tab",
            run: () => handleCycleTabs(-1),
          },
          {
            id: "go-home",
            label: "Go Home Workspace",
            dividerAbove: true,
            run: handleGoHome,
          },
        ],
      },
    ],
    [
      currentPath,
      handleCycleTabs,
      handleGoHome,
      handlePromptOpenWorkspace,
      handleRefresh,
      isIdeChatOpen,
      isTerminalPanelOpen,
      openCommandPalette,
      openGlobalSearchPanel,
      openIdeSettings,
      openNewTerminal,
      openQuickOpenPalette,
      outlineInputRef,
      setCreateParentPath,
      setCreateType,
      setIsIdeChatOpen,
      setSaveRequestToken,
      setSidebarMode,
      toggleTerminalPanel,
      workspacePath,
    ]
  );
}
