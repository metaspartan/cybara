import {
  Bug,
  Check,
  Copy,
  ExternalLink,
  GitFork,
  Hash,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDeleteSession, usePinSession, useRenameSession, useSessions } from "@/hooks/useChat";
import { chatApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChatMessage, SessionContextUsage, SessionTokenUsage } from "@/types";

interface ChatHeaderTitleMenuProps {
  sessionId: string;
  messages: ChatMessage[];
  agentId?: string;
  workspaceDir: string | null;
  useModelRouter: boolean;
  contextUsage: SessionContextUsage | null;
  tokenUsage: SessionTokenUsage | null;
  appVersion?: string;
  onDeleted: () => void;
}

const MENU_WIDTH = 256;
const MENU_PADDING = 8;

async function writeToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      return false;
    }
  }
}

export function ChatHeaderTitleMenu({
  sessionId,
  messages,
  agentId,
  workspaceDir,
  useModelRouter,
  contextUsage,
  tokenUsage,
  appVersion,
  onDeleted,
}: ChatHeaderTitleMenuProps) {
  const { data: sessionsList } = useSessions();
  const renameSession = useRenameSession();
  const pinSessionMutation = usePinSession();
  const deleteSessionMutation = useDeleteSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const [copiedDebugInfo, setCopiedDebugInfo] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const currentSummary = useMemo(
    () => sessionsList?.find((session) => session.id === sessionId) ?? null,
    [sessionsList, sessionId]
  );

  const derivedTitle = useMemo(() => {
    const explicitTitle = currentSummary?.title?.trim();
    if (explicitTitle) return explicitTitle;
    const firstUserMessage = messages.find(
      (message) => message.role === "user" && message.content.trim()
    );
    const snippet = firstUserMessage?.content.trim().replace(/\s+/g, " ");
    if (snippet) return snippet.length > 80 ? `${snippet.slice(0, 80)}…` : snippet;
    return null;
  }, [currentSummary, messages]);

  const title = derivedTitle ?? "Untitled chat";

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition({
      left: Math.max(
        MENU_PADDING,
        Math.min(rect.left, window.innerWidth - MENU_WIDTH - MENU_PADDING)
      ),
      top: Math.min(rect.bottom + 6, window.innerHeight - MENU_PADDING),
    });
  }, []);

  const flashCopy = useCallback((target: "id" | "debug") => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    if (target === "id") {
      setCopiedSessionId(true);
      setCopiedDebugInfo(false);
    } else {
      setCopiedDebugInfo(true);
      setCopiedSessionId(false);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedSessionId(false);
      setCopiedDebugInfo(false);
      copyTimerRef.current = null;
    }, 1500);
  }, []);

  const handleCopySessionId = useCallback(async () => {
    if (await writeToClipboard(sessionId)) flashCopy("id");
  }, [sessionId, flashCopy]);

  const handleCopyDebugInfo = useCallback(async () => {
    const debugPayload = {
      exportedAt: new Date().toISOString(),
      app: {
        version: appVersion ?? null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
      session: {
        id: sessionId,
        title: currentSummary?.title ?? derivedTitle ?? null,
        agentId: agentId ?? null,
        modelRouterEnabled: useModelRouter,
        workspaceDir,
        pinned: currentSummary?.pinned ?? null,
        createdAt: currentSummary?.created_at ?? null,
        updatedAt: currentSummary?.updated_at ?? null,
        messageCount: messages.length,
      },
      context: contextUsage ?? null,
      tokenUsage: tokenUsage ?? null,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp ?? null,
        thinking: message.thinking ?? null,
        imageCount: message.images?.length ?? 0,
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          name: call.name,
          arguments: call.arguments,
          result: call.result,
          status: call.status,
        })),
      })),
    };
    const serialized = JSON.stringify(debugPayload, null, 2);
    if (await writeToClipboard(serialized)) {
      flashCopy("debug");
      setMenuOpen(false);
    }
  }, [
    sessionId,
    appVersion,
    currentSummary,
    derivedTitle,
    agentId,
    useModelRouter,
    workspaceDir,
    contextUsage,
    tokenUsage,
    messages,
    flashCopy,
  ]);

  const beginRename = useCallback(() => {
    setTitleDraft(currentSummary?.title?.trim() || derivedTitle || "");
    setRenaming(true);
    setMenuOpen(false);
  }, [currentSummary, derivedTitle]);

  const submitRename = useCallback(async () => {
    const nextTitle = titleDraft.trim();
    setRenaming(false);
    if (!nextTitle || nextTitle === (currentSummary?.title?.trim() || "")) return;
    try {
      await renameSession.mutateAsync({ sessionId, title: nextTitle });
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  }, [titleDraft, sessionId, currentSummary, renameSession]);

  const handleTogglePin = useCallback(async () => {
    setMenuOpen(false);
    try {
      await pinSessionMutation.mutateAsync({ sessionId, pinned: !currentSummary?.pinned });
    } catch (error) {
      console.error("Failed to pin session:", error);
    }
  }, [sessionId, currentSummary, pinSessionMutation]);

  const handleOpenInNewWindow = useCallback(() => {
    setMenuOpen(false);
    window.open(`/chat?session=${encodeURIComponent(sessionId)}`, "_blank", "noopener");
  }, [sessionId]);

  const handleForkChat = useCallback(async () => {
    setMenuOpen(false);
    try {
      const response = await chatApi.forkSession(sessionId, { agentId });
      const forkedId = response.data?.fork?.sessionId;
      if (response.success && forkedId) {
        window.open(`/chat?session=${encodeURIComponent(forkedId)}`, "_blank", "noopener");
      } else {
        console.error("Failed to fork session:", response.data?.error ?? response.error);
      }
    } catch (error) {
      console.error("Failed to fork session:", error);
    }
  }, [sessionId, agentId]);

  const handleDelete = useCallback(async () => {
    setMenuOpen(false);
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    try {
      await deleteSessionMutation.mutateAsync(sessionId);
      onDeleted();
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }, [sessionId, deleteSessionMutation, onDeleted]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    const onMove = () => updateMenuPosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    setMenuOpen(false);
    setRenaming(false);
  }, [sessionId]);

  const menu =
    menuOpen &&
    createPortal(
      <div
        ref={menuRef}
        className="workspace-open-menu-panel fixed z-[1000] w-64 overflow-hidden rounded-xl border border-white/10 p-1.5 text-xs shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
        style={{
          left: menuPosition.left,
          top: menuPosition.top,
          backgroundColor: "var(--workspace-open-menu-bg)",
        }}
      >
        <button
          type="button"
          onClick={() => void handleCopySessionId()}
          title="Copy session ID"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10"
        >
          {copiedSessionId ? (
            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          ) : (
            <Hash className="w-3.5 h-3.5 shrink-0 text-gray-400" />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {copiedSessionId ? "Copied to clipboard" : "Session ID"}
            </span>
            <span className="truncate font-mono text-xs text-gray-200">{sessionId}</span>
          </span>
        </button>
        <div className="my-1 h-px bg-white/10" />
        <button
          type="button"
          onClick={() => void handleTogglePin()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          {currentSummary?.pinned ? (
            <PinOff className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <Pin className="w-3.5 h-3.5 text-gray-400" />
          )}
          {currentSummary?.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          onClick={beginRename}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          <Pencil className="w-3.5 h-3.5 text-gray-400" />
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            void handleCopySessionId();
            setMenuOpen(false);
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          <Copy className="w-3.5 h-3.5 text-gray-400" />
          Copy session ID
        </button>
        <button
          type="button"
          onClick={() => void handleCopyDebugInfo()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          {copiedDebugInfo ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Bug className="w-3.5 h-3.5 text-gray-400" />
          )}
          {copiedDebugInfo ? "Debug info copied" : "Copy debug info (JSON)"}
        </button>
        <button
          type="button"
          onClick={() => void handleForkChat()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          <GitFork className="w-3.5 h-3.5 text-gray-400" />
          Fork into new chat
        </button>
        <button
          type="button"
          onClick={handleOpenInNewWindow}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-gray-100 transition-colors hover:bg-white/10"
        >
          <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
          Open in new window
        </button>
        <div className="my-1 h-px bg-white/10" />
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete chat
        </button>
      </div>,
      document.body
    );

  return (
    <>
      <div className="flex flex-col min-w-0">
        {renaming ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => void submitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
            className="w-40 sm:w-64 bg-white/5 border border-white/15 rounded-md px-2 py-1 text-sm font-semibold text-white outline-none focus:border-white/30"
            placeholder="Chat title"
          />
        ) : (
          <button
            type="button"
            onClick={beginRename}
            title="Rename chat"
            className="text-sm sm:text-base font-semibold text-white truncate max-w-[9rem] sm:max-w-sm text-left cursor-pointer hover:text-white/80 transition-colors"
          >
            {title}
          </button>
        )}
      </div>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => {
            updateMenuPosition();
            setMenuOpen((open) => !open);
          }}
          aria-label="Chat options"
          aria-expanded={menuOpen}
          className={cn(
            "p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
            menuOpen ? "text-white bg-white/5" : "text-gray-500"
          )}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu}
      </div>
    </>
  );
}
