import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatWorkspaceTab,
  WORKSPACE_SINGLETON_KINDS,
  type WorkspaceTabInstance,
} from "./ChatWorkspacePanel";

interface UseChatWorkspaceTabsOptions {
  sessionId: string | null;
}

interface UseChatWorkspaceTabsResult {
  activeKind: ChatWorkspaceTab | null;
  activeTabId: string | null;
  closeTab: (id: string) => void;
  isOpen: boolean;
  openBrowser: (url: string) => void;
  openTab: (kind: ChatWorkspaceTab) => void;
  openFile: (path: string) => void;
  openSubagent: (runId: string, title: string) => void;
  selectTab: Dispatch<SetStateAction<string | null>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  tabs: WorkspaceTabInstance[];
  toggleTab: (kind: ChatWorkspaceTab) => void;
  updateTabTitle: (id: string, title: string) => void;
}

export function useChatWorkspaceTabs({
  sessionId,
}: UseChatWorkspaceTabsOptions): UseChatWorkspaceTabsResult {
  const [isOpen, setOpen] = useState(false);
  const [tabs, setTabs] = useState<WorkspaceTabInstance[]>([]);
  const [activeTabId, selectTab] = useState<string | null>(null);
  const tabIdRef = useRef(0);
  const previousSessionIdRef = useRef(sessionId);
  const activeKind = useMemo(
    () => tabs.find((instance) => instance.id === activeTabId)?.kind ?? null,
    [activeTabId, tabs]
  );

  useEffect(() => {
    if (!isOpen || tabs.length === 0) return;
    if (tabs.some((instance) => instance.id === activeTabId)) return;
    selectTab(tabs[0].id);
  }, [activeTabId, isOpen, tabs]);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    previousSessionIdRef.current = sessionId;
    const next = tabs.filter((instance) => !(instance.kind === "subagents" && instance.pageKey));
    if (next.length === tabs.length) return;
    if (!(activeTabId && next.some((instance) => instance.id === activeTabId))) {
      selectTab(next[0]?.id ?? null);
    }
    setTabs(next);
  }, [activeTabId, sessionId, tabs]);

  const openTab = useCallback(
    (kind: ChatWorkspaceTab): void => {
      setOpen(true);
      const existing = WORKSPACE_SINGLETON_KINDS.has(kind)
        ? tabs.find((instance) => instance.kind === kind)
        : undefined;
      if (existing) {
        selectTab(existing.id);
        return;
      }
      const id = `${kind}-${(tabIdRef.current += 1)}`;
      const pageKey =
        kind === "browser" && tabs.some((instance) => instance.kind === "browser") ? id : undefined;
      selectTab(id);
      setTabs((current) => [...current, { id, kind, pageKey }]);
    },
    [tabs]
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

  const openBrowser = useCallback(
    (url: string): void => {
      const navigationUrl = url.trim();
      if (!navigationUrl) return;
      setOpen(true);
      const existing =
        tabs.find((instance) => instance.id === activeTabId && instance.kind === "browser") ??
        tabs.find((instance) => instance.kind === "browser");
      if (existing) {
        selectTab(existing.id);
        setTabs((current) =>
          current.map((instance) =>
            instance.id === existing.id
              ? {
                  ...instance,
                  navigationUrl,
                  navigationRequest: (instance.navigationRequest ?? 0) + 1,
                }
              : instance
          )
        );
        return;
      }
      const id = `browser-${(tabIdRef.current += 1)}`;
      selectTab(id);
      setTabs((current) => [
        ...current,
        { id, kind: "browser", navigationUrl, navigationRequest: 1 },
      ]);
    },
    [activeTabId, tabs]
  );

  const openFile = useCallback(
    (path: string): void => {
      const normalizedPath = path.trim();
      if (!normalizedPath) return;
      setOpen(true);
      const existing = tabs.find((instance) => instance.kind === "files");
      if (existing) {
        selectTab(existing.id);
        setTabs((current) =>
          current.map((instance) =>
            instance.id === existing.id ? { ...instance, pageKey: normalizedPath } : instance
          )
        );
        return;
      }
      const id = `files-${(tabIdRef.current += 1)}`;
      selectTab(id);
      setTabs((current) => [...current, { id, kind: "files", pageKey: normalizedPath }]);
    },
    [tabs]
  );

  const openSubagent = useCallback(
    (runId: string, title: string): void => {
      const normalizedRunId = runId.trim();
      if (!normalizedRunId) return;
      setOpen(true);
      const existing = tabs.find(
        (instance) => instance.kind === "subagents" && instance.pageKey === normalizedRunId
      );
      if (existing) {
        selectTab(existing.id);
        return;
      }
      const id = `subagent-${(tabIdRef.current += 1)}`;
      selectTab(id);
      setTabs((current) => [
        ...current,
        {
          id,
          kind: "subagents",
          pageKey: normalizedRunId,
          title: title.trim() || "Subagent",
        },
      ]);
    },
    [tabs]
  );

  const closeTab = useCallback(
    (id: string): void => {
      const index = tabs.findIndex((instance) => instance.id === id);
      if (index === -1) return;
      const next = tabs.filter((instance) => instance.id !== id);
      if (activeTabId === id) {
        selectTab(next[Math.min(index, next.length - 1)]?.id ?? null);
      }
      setTabs(next);
    },
    [activeTabId, tabs]
  );

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
    openBrowser,
    openFile,
    openSubagent,
    openTab,
    selectTab,
    setOpen,
    tabs,
    toggleTab,
    updateTabTitle,
  };
}
