import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatWorkspaceTab,
  WORKSPACE_SINGLETON_KINDS,
  type WorkspaceTabInstance,
} from "./ChatWorkspacePanel";

interface UseChatWorkspaceTabsOptions {
  onOpen: () => void;
}

interface UseChatWorkspaceTabsResult {
  activeKind: ChatWorkspaceTab | null;
  activeTabId: string | null;
  closeTab: (id: string) => void;
  isOpen: boolean;
  openTab: (kind: ChatWorkspaceTab) => void;
  selectTab: Dispatch<SetStateAction<string | null>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  tabs: WorkspaceTabInstance[];
  toggleTab: (kind: ChatWorkspaceTab) => void;
  updateTabTitle: (id: string, title: string) => void;
}

export function useChatWorkspaceTabs({
  onOpen,
}: UseChatWorkspaceTabsOptions): UseChatWorkspaceTabsResult {
  const [isOpen, setOpen] = useState(false);
  const [tabs, setTabs] = useState<WorkspaceTabInstance[]>([]);
  const [activeTabId, selectTab] = useState<string | null>(null);
  const tabIdRef = useRef(0);
  const activeKind = useMemo(
    () => tabs.find((instance) => instance.id === activeTabId)?.kind ?? null,
    [activeTabId, tabs]
  );

  useEffect(() => {
    if (!isOpen || tabs.length === 0) return;
    if (tabs.some((instance) => instance.id === activeTabId)) return;
    selectTab(tabs[0].id);
  }, [activeTabId, isOpen, tabs]);

  const openTab = useCallback(
    (kind: ChatWorkspaceTab): void => {
      setOpen(true);
      onOpen();
      setTabs((current) => {
        if (WORKSPACE_SINGLETON_KINDS.has(kind)) {
          const existing = current.find((instance) => instance.kind === kind);
          if (existing) {
            selectTab(existing.id);
            return current;
          }
        }
        const id = `${kind}-${(tabIdRef.current += 1)}`;
        const pageKey =
          kind === "browser" && current.some((instance) => instance.kind === "browser")
            ? id
            : undefined;
        selectTab(id);
        return [...current, { id, kind, pageKey }];
      });
    },
    [onOpen]
  );

  const toggleTab = useCallback(
    (kind: ChatWorkspaceTab): void => {
      if (isOpen && activeKind === kind) {
        setOpen(false);
        return;
      }
      openTab(kind);
    },
    [activeKind, isOpen, openTab]
  );

  const closeTab = useCallback((id: string): void => {
    setTabs((current) => {
      const index = current.findIndex((instance) => instance.id === id);
      if (index === -1) return current;
      const next = current.filter((instance) => instance.id !== id);
      selectTab((previous) =>
        previous === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : previous
      );
      return next;
    });
  }, []);

  const updateTabTitle = useCallback((id: string, title: string): void => {
    setTabs((current) =>
      current.map((instance) => (instance.id === id ? { ...instance, title } : instance))
    );
  }, []);

  return {
    activeKind,
    activeTabId,
    closeTab,
    isOpen,
    openTab,
    selectTab,
    setOpen,
    tabs,
    toggleTab,
    updateTabTitle,
  };
}
