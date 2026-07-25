import { chatApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { NavigateFunction } from "react-router";
import {
  clampDiffPanelWidth,
  type FileChangeItem,
  type FileChangeSummary,
  persistDiffPanelWidth,
  persistWorkspaceDir,
  readPersistedDiffPanelWidth,
  resolvePathForIde,
} from "./chatModel";
import { pickWorkspaceDirectory } from "./workspacePicker";

interface UseChatWorkspaceActionsOptions {
  sessionId: string | null;
  workspaceDir: string | null;
  setWorkspaceDir: (workspaceDir: string | null) => void;
  setLastWorkspaceDir: Dispatch<SetStateAction<string | null>>;
  effectiveWorkspaceDir: string | null;
  navigate: NavigateFunction;
  openWorkspaceFile: (path: string) => void;
  sessionFileChanges: FileChangeSummary | null;
}

interface ChatWorkspaceActionsController {
  workspaceSaving: boolean;
  showWorkspacePicker: boolean;
  setShowWorkspacePicker: Dispatch<SetStateAction<boolean>>;
  diffPanelWidth: number;
  selectedDiffPath: string | null;
  setSelectedDiffPath: Dispatch<SetStateAction<string | null>>;
  applySessionWorkspace: (workspaceDir: string | null) => Promise<void>;
  handleSelectWorkspace: () => Promise<void>;
  handleOpenWorkspaceInCybaraIde: (workspaceDir: string) => Promise<void>;
  handleOpenPathInIde: (path: string) => void;
  handleOpenDiffFileInWorkspace: (file: FileChangeItem) => void;
  handleDiffPanelResizeStart: (event: ReactMouseEvent<HTMLElement>) => void;
}

export function useChatWorkspaceActions({
  sessionId,
  workspaceDir,
  setWorkspaceDir,
  setLastWorkspaceDir,
  effectiveWorkspaceDir,
  navigate,
  openWorkspaceFile,
  sessionFileChanges,
}: UseChatWorkspaceActionsOptions): ChatWorkspaceActionsController {
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [diffPanelWidth, setDiffPanelWidth] = useState<number>(() => readPersistedDiffPanelWidth());
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const diffPanelResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const diffPanelResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    persistDiffPanelWidth(diffPanelWidth);
  }, [diffPanelWidth]);

  useEffect(() => {
    if (!sessionFileChanges || sessionFileChanges.files.length === 0) {
      if (selectedDiffPath !== null) {
        setSelectedDiffPath(null);
      }
      return;
    }

    if (
      selectedDiffPath &&
      sessionFileChanges.files.some((file) => file.path === selectedDiffPath)
    ) {
      return;
    }

    setSelectedDiffPath(sessionFileChanges.files[0]?.path || null);
  }, [selectedDiffPath, sessionFileChanges]);

  const applySessionWorkspace = useCallback(
    async (nextWorkspaceDir: string | null) => {
      const previousWorkspaceDir = workspaceDir;
      setWorkspaceDir(nextWorkspaceDir);
      if (nextWorkspaceDir) {
        persistWorkspaceDir(nextWorkspaceDir);
        setLastWorkspaceDir(nextWorkspaceDir);
      }

      if (!sessionId) {
        return;
      }

      setWorkspaceSaving(true);
      try {
        const response = await chatApi.updateSessionWorkspace(sessionId, nextWorkspaceDir);
        if (!response.success || !response.data || response.data.success === false) {
          const message =
            (response.data && "error" in response.data ? response.data.error : null) ||
            response.error ||
            "Failed to update session workspace";
          throw new Error(message || "Failed to update session workspace");
        }
        const resolvedWorkspaceDir = response.data.workspaceDir || null;
        setWorkspaceDir(resolvedWorkspaceDir);
        if (resolvedWorkspaceDir) {
          persistWorkspaceDir(resolvedWorkspaceDir);
          setLastWorkspaceDir(resolvedWorkspaceDir);
        }
      } catch (error) {
        setWorkspaceDir(previousWorkspaceDir || null);
        console.error("Failed to update session workspace:", error);
      } finally {
        setWorkspaceSaving(false);
      }
    },
    [sessionId, setWorkspaceDir, workspaceDir]
  );

  const handleSelectWorkspace = useCallback(async () => {
    const selection = await pickWorkspaceDirectory(effectiveWorkspaceDir);
    if (selection.requiresFallback) {
      setShowWorkspacePicker(true);
      return;
    }
    if (selection.path) {
      await applySessionWorkspace(selection.path);
    }
  }, [applySessionWorkspace, effectiveWorkspaceDir]);

  const handleOpenWorkspaceInCybaraIde = useCallback(
    async (targetWorkspaceDir: string) => {
      const normalized = targetWorkspaceDir.trim();
      if (!normalized) return;
      try {
        persistWorkspaceDir(normalized);
        setLastWorkspaceDir(normalized);
        const params = new URLSearchParams();
        params.set("workspacePath", normalized);
        navigate(`/ide?${params.toString()}`);
      } catch (error) {
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Unable to open workspace in Cybara IDE"
          );
      }
    },
    [navigate]
  );

  const handleOpenPathInIde = useCallback(
    (path: string) => {
      const resolvedPath = resolvePathForIde(path, effectiveWorkspaceDir);
      if (!resolvedPath) return;
      const params = new URLSearchParams();
      params.set("path", resolvedPath);
      if (effectiveWorkspaceDir) params.set("workspacePath", effectiveWorkspaceDir);
      params.set("from", "chat-workspace");
      navigate(`/ide?${params.toString()}`);
    },
    [effectiveWorkspaceDir, navigate]
  );

  const handleOpenDiffFileInWorkspace = useCallback(
    (file: FileChangeItem) => {
      const resolvedPath = resolvePathForIde(file.path, effectiveWorkspaceDir);
      if (!resolvedPath) return;
      openWorkspaceFile(resolvedPath);
    },
    [effectiveWorkspaceDir, openWorkspaceFile]
  );

  const handleDiffPanelResizeStart = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      diffPanelResizeStateRef.current = {
        startX: event.clientX,
        startWidth: diffPanelWidth,
      };
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const state = diffPanelResizeStateRef.current;
        if (!state) return;
        const delta = state.startX - moveEvent.clientX;
        setDiffPanelWidth(clampDiffPanelWidth(state.startWidth + delta));
      };

      const handleMouseUp = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        diffPanelResizeCleanupRef.current = null;
      };

      diffPanelResizeCleanupRef.current = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [diffPanelWidth]
  );

  return {
    workspaceSaving,
    showWorkspacePicker,
    setShowWorkspacePicker,
    diffPanelWidth,
    selectedDiffPath,
    setSelectedDiffPath,
    applySessionWorkspace,
    handleSelectWorkspace,
    handleOpenWorkspaceInCybaraIde,
    handleOpenPathInIde,
    handleOpenDiffFileInWorkspace,
    handleDiffPanelResizeStart,
  };
}
