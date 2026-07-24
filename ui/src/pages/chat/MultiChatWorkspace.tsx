import { LocalFolderPickerModal } from "@/components/LocalFolderPickerModal";
import { Modal } from "@/components/ui";
import { useAgentSummaries, useUpdateAgentReasoning } from "@/hooks/useApi";
import {
  useChat,
  useSessionDetail,
  useSessions,
  useUpdateSessionAgent,
  SESSION_DETAIL_QUERY_KEY,
} from "@/hooks/useChat";
import { chatApi, routerApi, settingsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import { openExternal } from "@/utils/openExternal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  GripVertical,
  LayoutGrid,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ChatLightboxImage } from "./ChatImageLightbox";
import { ChatAgentControls, MODEL_ROUTER_SELECTOR_VALUE } from "./ChatAgentControls";
import { ChatComposerAttachments } from "./ChatComposerAttachments";
import {
  ChatApprovalControls,
  normalizeToolApprovalMode,
  type ToolApprovalMode,
} from "./ChatFollowUpControls";
import { ChatImageLightbox } from "./ChatImageLightbox";
import { ChatMessageTimeline } from "./ChatMessageTimeline";
import { MultiChatPaneEnvironment } from "./MultiChatPaneEnvironment";
import { NewChatWorkspaceBar } from "./NewChatWorkspaceBar";
import { ChatReasoningControl } from "./ChatReasoningControl";
import type { ChatMessage } from "./chatModel";
import {
  persistWorkspaceDir,
  readPersistedWorkspaceDir,
  sessionDisplayTitle,
  sessionPreviewText,
  sessionRouteLabel,
} from "./chatModel";
import {
  addMultiChatSession,
  buildMultiChatPath,
  MULTI_CHAT_DRAG_TYPE,
  MULTI_CHAT_MAX_PANES,
  normalizeMultiChatSessionIds,
  parseMultiChatSessionIds,
  persistMultiChatSessionIds,
  readPersistedMultiChatSessionIds,
  reorderMultiChatSessions,
  replaceMultiChatSession,
  resolveMultiChatSlotCount,
} from "./multiChatLayout";
import { useMultiChatDropTarget } from "./useMultiChatDropTarget";
import { useChatAttachments } from "./useChatAttachments";
import { useChatDictation } from "./useChatDictation";
import { MULTI_CHAT_ACTIVE_STATUSES, type MultiChatLiveState } from "./multiChatLiveStatus";
import { useMultiChatLiveStatuses } from "./useMultiChatLiveStatuses";
import { useEnvironmentGitBranches } from "./useEnvironmentGitBranches";
import { pickWorkspaceDirectory } from "./workspacePicker";
import type { AgentSummary } from "@/types";
import type { ChatSidebarSession } from "./sessionGrouping";

const MULTI_CHAT_RENDERED_MESSAGE_LIMIT = 80;
const MULTI_CHAT_REFRESH_THROTTLE_MS = 750;
interface MultiChatPickerProps {
  isOpen: boolean;
  sessions: ChatSidebarSession[];
  selectedIds: string[];
  onClose: () => void;
  onSelect: (sessionId: string) => void;
}

interface MultiChatPaneProps {
  dropActive: boolean;
  dropPreview: boolean;
  agents: AgentSummary[];
  approvalMode: ToolApprovalMode;
  approvalUpdating: boolean;
  environmentOpen: boolean;
  index: number;
  modelRouterEnabled: boolean;
  sessionId: string;
  summary?: ChatSidebarSession;
  status?: MultiChatLiveState;
  onApprovalChange: (mode: ToolApprovalMode) => void;
  onOpenPicker: (index: number) => void;
  onOpenImage: (src: string, alt: string) => void;
  onRemove: (sessionId: string) => void;
  onReplaceSession: (previousSessionId: string, nextSessionId: string) => void;
  onRefresh: (sessionId: string) => void;
  onToggleEnvironment: (sessionId: string) => void;
}

const MULTI_CHAT_DRAFT_PREFIX = "draft-";

function createMultiChatDraftId(): string {
  return `${MULTI_CHAT_DRAFT_PREFIX}${crypto.randomUUID()}`;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function multiChatStatusLabel(status?: MultiChatLiveState): string {
  if (!status || !MULTI_CHAT_ACTIVE_STATUSES.has(status.status)) return "Ready";
  if (status.status === "tool_executing") return status.detail || "Using tools";
  if (status.status === "compacting") return "Compacting context";
  if (status.status === "generating") return "Responding";
  return status.detail || "Thinking";
}

function sessionSearchText(session: ChatSidebarSession): string {
  const record = session as unknown as Record<string, unknown>;
  return [
    sessionDisplayTitle(record),
    sessionRouteLabel(record),
    session.workspace_dir,
    sessionPreviewText(session.last_message?.content),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function MultiChatPicker({
  isOpen,
  sessions,
  selectedIds,
  onClose,
  onSelect,
}: MultiChatPickerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const results = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            !selectedIdSet.has(session.id) &&
            (!deferredQuery || sessionSearchText(session).includes(deferredQuery))
        )
        .slice(0, 30),
    [deferredQuery, selectedIdSet, sessions]
  );

  const closePicker = () => {
    setQuery("");
    onClose();
  };

  const selectSession = (sessionId: string) => {
    setQuery("");
    onSelect(sessionId);
  };

  return (
    <Modal isOpen={isOpen} onClose={closePicker} size="md" surface="bare" backdrop="subtle">
      <div className="space-y-2" data-testid="multi-chat-picker">
        <div className="theme-tooltip-panel relative rounded-xl p-2 shadow-2xl">
          <Search className="theme-text-subtle absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            role="searchbox"
            aria-label="Search chats to add"
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !results[0]) return;
              event.preventDefault();
              selectSession(results[0].id);
            }}
            placeholder="Search chats to add…"
            className="themed-form-control w-full rounded-lg !border-0 py-2.5 pl-10 pr-9 text-sm !outline-none !ring-0 !shadow-none hover:!border-0 focus:!border-0 focus:!outline-none focus:!ring-0 focus:!shadow-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="theme-muted-icon-button absolute right-2.5 top-1/2 -translate-y-1/2"
              aria-label="Clear chat search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="theme-tooltip-panel max-h-[min(65vh,34rem)] space-y-1 overflow-y-auto rounded-xl p-1 shadow-2xl">
          {results.length ? (
            results.map((session) => {
              const record = session as unknown as Record<string, unknown>;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => selectSession(session.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <MessageSquare className="theme-text-subtle h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="theme-text-primary block truncate text-sm font-medium">
                      {sessionDisplayTitle(record)}
                    </span>
                    <span className="theme-text-muted block truncate text-xs">
                      {[session.workspace_dir, sessionRouteLabel(record)]
                        .filter(Boolean)
                        .join(" · ") || "No workspace"}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="theme-text-muted py-8 text-center text-sm">No matching chats</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MultiChatPane({
  agents,
  approvalMode,
  approvalUpdating,
  dropActive,
  dropPreview,
  environmentOpen,
  index,
  modelRouterEnabled,
  sessionId,
  summary,
  status,
  onApprovalChange,
  onOpenPicker,
  onOpenImage,
  onRemove,
  onReplaceSession,
  onRefresh,
  onToggleEnvironment,
}: MultiChatPaneProps) {
  const navigate = useNavigate();
  const isDraft = sessionId.startsWith(MULTI_CHAT_DRAFT_PREFIX);
  const detailQuery = useSessionDetail(sessionId, !isDraft);
  const detail = detailQuery.data;
  const updateSessionAgent = useUpdateSessionAgent();
  const updateAgentReasoning = useUpdateAgentReasoning();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [useModelRouter, setUseModelRouter] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftWorkspaceDir, setDraftWorkspaceDir] = useState<string | null>(() =>
    isDraft ? readPersistedWorkspaceDir() : null
  );
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const {
    messages: liveMessages,
    isLoading: responsePending,
    loadSession,
    sendMessage,
    stopGenerating,
  } = useChat(selectedAgentId || detail?.agent_id, { useModelRouter });
  const {
    addAttachmentFiles,
    consumeAttachments,
    handleComposerDrop,
    handleComposerPaste,
    imageDragActive,
    pendingFiles,
    pendingImages,
    removePendingFile,
    removePendingImage,
    setImageDragActive,
  } = useChatAttachments();
  const {
    dictating,
    error: dictationError,
    handleToggle: handleToggleDictation,
    runtime: dictationRuntime,
    status: dictationStatus,
    transcribing: dictationTranscribing,
  } = useChatDictation(setDraft);
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isActive = !!status && MULTI_CHAT_ACTIVE_STATUSES.has(status.status);
  const selectedAgent = agents.find((agent) => agent.id === (selectedAgentId || detail?.agent_id));
  const effectiveWorkspaceDir = isDraft ? draftWorkspaceDir : detail?.workspace_dir || null;
  const environmentGit = useEnvironmentGitBranches(isDraft ? draftWorkspaceDir : null);

  useEffect(() => {
    if (!detail) return;
    setSelectedAgentId(detail.agent_id || undefined);
    setUseModelRouter(detail.use_model_router === true);
  }, [detail]);

  useEffect(() => {
    if (isActive) setSending(false);
  }, [isActive]);

  useEffect(() => {
    if (!detail || isDraft) return;
    loadSession(sessionId, detail.messagesList, detail.workspace_dir || null, isActive);
  }, [detail, isActive, isDraft, loadSession, sessionId]);

  const messages = useMemo(
    () => (liveMessages.length > 0 ? liveMessages : detail?.messagesList || []),
    [detail?.messagesList, liveMessages]
  );
  const displayMessages = useMemo(() => {
    const content = status?.streamingContent;
    if (!content) return messages;
    return [
      ...messages,
      {
        role: "assistant" as const,
        content,
        timestamp: new Date(status.startedAtMs).toISOString(),
      },
    ];
  }, [messages, status?.startedAtMs, status?.streamingContent]);
  const firstRenderedIndex = Math.max(
    0,
    displayMessages.length - MULTI_CHAT_RENDERED_MESSAGE_LIMIT
  );
  const visibleEntries = useMemo(
    () =>
      displayMessages.slice(firstRenderedIndex).map((message, offset) => ({
        message: message as ChatMessage,
        originalIndex: firstRenderedIndex + offset,
      })),
    [displayMessages, firstRenderedIndex]
  );

  useEffect(() => {
    if (!autoFollow) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }, [autoFollow, displayMessages.length, status?.detail, status?.streamingContent]);

  const titleRecord = (detail || summary || { id: sessionId }) as unknown as Record<
    string,
    unknown
  >;
  const title = isDraft ? "New chat" : sessionDisplayTitle(titleRecord);
  const route = isDraft
    ? selectedAgent?.model || selectedAgent?.name || "Select an agent"
    : sessionRouteLabel(titleRecord);

  const handleSelectAgent = async (agentId?: string) => {
    const previousAgentId = selectedAgentId;
    const previousUseModelRouter = useModelRouter;
    const nextUseModelRouter = agentId === MODEL_ROUTER_SELECTOR_VALUE;
    const nextAgentId = nextUseModelRouter ? undefined : agentId;
    setUseModelRouter(nextUseModelRouter);
    setSelectedAgentId(nextAgentId);
    if (isDraft) return;
    try {
      await updateSessionAgent.mutateAsync({
        sessionId,
        agentId: nextAgentId,
        useModelRouter: nextUseModelRouter,
      });
      onRefresh(sessionId);
    } catch (error) {
      setSelectedAgentId(previousAgentId);
      setUseModelRouter(previousUseModelRouter);
      useUIStore
        .getState()
        .addToast(
          "error",
          error instanceof Error ? error.message : "Failed to update session agent"
        );
    }
  };

  const handleReasoningChange = async (effort: AgentSummary["reasoning_effort"]): Promise<void> => {
    if (!selectedAgent) return;
    try {
      await updateAgentReasoning.mutateAsync({ id: selectedAgent.id, effort: effort ?? null });
    } catch (error) {
      useUIStore
        .getState()
        .addToast(
          "error",
          error instanceof Error ? error.message : "Failed to update reasoning effort"
        );
    }
  };

  const applyDraftWorkspace = (path: string | null): void => {
    const normalized = path?.trim() || null;
    setDraftWorkspaceDir(normalized);
    if (normalized) persistWorkspaceDir(normalized);
  };

  const handleSelectWorkspace = async (): Promise<void> => {
    setWorkspaceSaving(true);
    const selection = await pickWorkspaceDirectory(draftWorkspaceDir);
    setWorkspaceSaving(false);
    if (selection.requiresFallback) {
      setShowWorkspacePicker(true);
      return;
    }
    if (selection.path) applyDraftWorkspace(selection.path);
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    const hasAttachments = pendingImages.length > 0 || pendingFiles.length > 0;
    if ((!content && !hasAttachments) || sending) return;
    const attachments = consumeAttachments(content);
    setDraft("");
    setSending(true);
    setAutoFollow(true);
    try {
      const response = await sendMessage(attachments.message, {
        ...(!isDraft ? { sessionId } : {}),
        workspaceDir: effectiveWorkspaceDir,
        queueMode: isActive ? "queue" : undefined,
        images: attachments.images,
      });
      const resolvedSessionId = response?.sessionId;
      if (isDraft && resolvedSessionId) {
        onReplaceSession(sessionId, resolvedSessionId);
        onRefresh(resolvedSessionId);
      } else {
        onRefresh(sessionId);
      }
    } catch (error) {
      setDraft(content);
      useUIStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleStop = async () => {
    try {
      if (isDraft) return;
      await chatApi.stopSession(sessionId);
      stopGenerating(sessionId);
      onRefresh(sessionId);
    } catch (error) {
      useUIStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Failed to stop response");
    }
  };

  return (
    <section
      className={cn(
        "group/pane relative flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border bg-[var(--surface-panel)] transition-[border-color,background-color] duration-150 lg:min-h-0",
        dropActive
          ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.06)]"
          : dropPreview
            ? "border-dashed border-[rgba(var(--accent-primary),0.42)] bg-[rgba(var(--accent-primary),0.025)]"
            : "border-[var(--surface-border)]"
      )}
      data-testid="multi-chat-pane"
      data-session-id={sessionId}
      data-multi-chat-drop-index={index}
      data-drop-active={dropActive}
      data-drop-preview={dropPreview}
    >
      <LocalFolderPickerModal
        isOpen={isDraft && showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={applyDraftWorkspace}
        defaultPath={draftWorkspaceDir}
        title="Select Session Workspace"
        description="Choose the local folder this chat should use for file tools, git context, and workspace-aware prompts."
      />
      {dropPreview ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-1 z-40 flex items-center justify-center rounded-md border border-dashed transition-colors",
            dropActive
              ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--surface-panel-rgb),0.9)]"
              : "border-[rgba(var(--accent-primary),0.34)] bg-[rgba(var(--surface-panel-rgb),0.3)]"
          )}
        >
          {dropActive ? (
            <span className="flex items-center gap-2 rounded-md bg-[rgb(var(--accent-primary))] px-3 py-2 text-xs font-semibold text-white">
              <MessageSquarePlus className="h-4 w-4" />
              Drop chat here
            </span>
          ) : null}
        </div>
      ) : null}
      <header
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(MULTI_CHAT_DRAG_TYPE, sessionId);
        }}
        className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b border-[var(--surface-border)] px-2.5 active:cursor-grabbing"
      >
        <GripVertical className="theme-text-subtle h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="theme-text-primary block truncate text-[13px] font-semibold">
            {title}
          </span>
          <span className="theme-text-muted flex items-center gap-1.5 truncate text-[10px]">
            {isActive ? <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" /> : null}
            <span className="truncate">
              {isActive ? multiChatStatusLabel(status) : route || "Ready"}
            </span>
          </span>
        </span>
        <button
          type="button"
          className={cn(
            "theme-muted-icon-button flex h-7 w-7 items-center justify-center rounded-md",
            environmentOpen && "bg-[var(--surface-hover)] text-[var(--text-primary)]"
          )}
          onClick={() => onToggleEnvironment(sessionId)}
          title="Environment"
          aria-label={`${environmentOpen ? "Hide" : "Show"} environment for ${title}`}
          aria-expanded={environmentOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        {!isDraft ? (
          <button
            type="button"
            className="theme-muted-icon-button flex h-7 w-7 items-center justify-center rounded-md"
            onClick={() => navigate(`/chat?session=${encodeURIComponent(sessionId)}`)}
            title="Open full chat"
            aria-label={`Open ${title} as full chat`}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="theme-muted-icon-button flex h-7 w-7 items-center justify-center rounded-md"
          onClick={() => onRemove(sessionId)}
          title="Close pane"
          aria-label={`Close ${title}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {environmentOpen ? (
        <MultiChatPaneEnvironment
          agent={selectedAgent}
          detail={detail}
          draft={isDraft}
          messageCount={messages.length}
          statusLabel={multiChatStatusLabel(status)}
          workspaceDir={effectiveWorkspaceDir}
          onReplace={() => onOpenPicker(index)}
        />
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          setAutoFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 96);
        }}
        className="chat-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {!isDraft && detailQuery.isLoading && messages.length === 0 ? (
          <div className="theme-text-muted flex h-full min-h-48 items-center justify-center gap-2 text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat…
          </div>
        ) : !isDraft && detailQuery.isError && messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-red-300">Unable to load this chat.</p>
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className="rounded-md border border-[var(--surface-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            >
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="theme-text-muted flex h-full min-h-48 items-center justify-center text-sm">
            {isDraft ? "Start a new conversation." : "This chat has no messages yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {firstRenderedIndex > 0 ? (
              <button
                type="button"
                onClick={() => navigate(`/chat?session=${encodeURIComponent(sessionId)}`)}
                className="theme-text-muted mx-auto block rounded-md px-3 py-1.5 text-xs hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                Open full chat to view {firstRenderedIndex} earlier messages
              </button>
            ) : null}
            <ChatMessageTimeline
              compact
              copiedMessageIndex={copiedIndex}
              entries={visibleEntries}
              forkingMessageIndex={null}
              goldenTurnsEnabled={false}
              liveActivities={status?.activities || []}
              liveCurrentStep={status?.currentStep || null}
              liveStatus={status?.liveStatus || "idle"}
              liveStartedAtMs={status?.startedAtMs}
              messageProcessMap={{}}
              savingGoldenMessageIndex={null}
              sessionId={sessionId}
              showWorkingTimeline={isActive}
              speakingMessageIndex={null}
              workspaceDir={effectiveWorkspaceDir}
              onCopyMessage={(messageIndex, content) => {
                void navigator.clipboard.writeText(content).then(() => {
                  setCopiedIndex(messageIndex);
                  window.setTimeout(() => setCopiedIndex(null), 1400);
                });
              }}
              onForkSession={() => undefined}
              onOpenArtifact={() => navigate(`/chat?session=${encodeURIComponent(sessionId)}`)}
              onOpenImage={onOpenImage}
              onOpenLink={(href) => {
                void openExternal(href);
                return true;
              }}
              onReadAloud={() => undefined}
              onRevert={() => undefined}
              onSaveGolden={() => undefined}
            />
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => void handleSend(event)}
        className="chat-composer-responsive shrink-0 border-t border-[var(--surface-border)] p-2.5"
      >
        {dictationError || dictationStatus ? (
          <div
            className={cn(
              "mb-1.5 truncate rounded-md px-2 py-1 text-[10px]",
              dictationError ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"
            )}
            role={dictationError ? "alert" : "status"}
          >
            {dictationError || dictationStatus}
          </div>
        ) : null}
        {isDraft ? (
          <NewChatWorkspaceBar
            branches={environmentGit.branches}
            changingBranch={environmentGit.changingBranch}
            className="mx-0 rounded-t-lg"
            currentBranch={environmentGit.currentBranch}
            error={environmentGit.error}
            loading={environmentGit.loading}
            onCreateBranch={environmentGit.createAndCheckout}
            onClearWorkspace={() => applyDraftWorkspace(null)}
            onRefreshBranches={environmentGit.refresh}
            onSelectWorkspace={() => void handleSelectWorkspace()}
            onSwitchBranch={environmentGit.checkout}
            workspaceDir={draftWorkspaceDir}
            workspaceSaving={workspaceSaving}
          />
        ) : null}
        <div
          className={cn(
            "chat-composer-surface rounded-lg border px-3 py-2 transition-colors",
            isDraft && "rounded-t-none",
            imageDragActive && "border-[rgba(var(--accent-primary),0.6)]"
          )}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file")) {
              event.preventDefault();
              setImageDragActive(true);
            }
          }}
          onDragLeave={() => setImageDragActive(false)}
          onDrop={handleComposerDrop}
        >
          <ChatComposerAttachments
            compact
            imageInputRef={imageInputRef}
            pendingFiles={pendingFiles}
            pendingImages={pendingImages}
            onAddAttachmentFiles={addAttachmentFiles}
            onRemovePendingFile={removePendingFile}
            onRemovePendingImage={removePendingImage}
          />
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handleComposerPaste}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void handleSend();
            }}
            rows={1}
            data-chat-composer-input="true"
            placeholder={isActive ? "Queue a follow-up…" : "Message this chat…"}
            aria-label={`Message ${title}`}
            className="max-h-28 min-h-7 w-full resize-none border-0 bg-transparent text-sm text-[var(--text-primary)] !outline-none !ring-0 placeholder:text-[var(--form-control-placeholder)] focus:border-transparent focus:!outline-none focus:!ring-0 focus-visible:!outline-none"
          />
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <ChatApprovalControls
              mode={approvalMode}
              onChange={onApprovalChange}
              updating={approvalUpdating}
            />
            <ChatAgentControls
              agents={agents}
              selectedAgentId={selectedAgentId || detail?.agent_id}
              modelRouterEnabled={modelRouterEnabled}
              useModelRouter={useModelRouter}
              contextUsage={detail?.contextUsage}
              onSelectAgent={(agentId) => void handleSelectAgent(agentId)}
              updating={updateSessionAgent.isPending}
              controlId={`multi-chat-agent-selector-${index}`}
            />
            <span className="min-w-0 flex-1" />
            <ChatReasoningControl
              effort={selectedAgent?.reasoning_effort}
              provider={
                selectedAgent?.provider_type ??
                selectedAgent?.provider ??
                selectedAgent?.provider_id
              }
              model={selectedAgent?.model}
              mode={selectedAgent?.reasoning_mode}
              supportedEfforts={selectedAgent?.reasoning_efforts}
              disabled={!selectedAgent || useModelRouter}
              updating={updateAgentReasoning.isPending}
              onChange={(effort) => void handleReasoningChange(effort)}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="composer-icon-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-[var(--icon-muted)] hover:text-[var(--text-primary)]"
              title="Attach image or file"
              aria-label={`Attach image or file to ${title}`}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleToggleDictation()}
              disabled={dictationTranscribing}
              className={cn(
                "composer-icon-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-[var(--icon-muted)] hover:text-[var(--text-primary)] disabled:opacity-40",
                dictating && "bg-red-500/15 text-red-300"
              )}
              title={
                dictationTranscribing
                  ? "Transcribing dictation"
                  : dictating
                    ? "Stop dictation"
                    : dictationRuntime.engine
                      ? `Start ${dictationRuntime.label.toLowerCase()}`
                      : dictationRuntime.unsupportedReason || "Dictation unavailable"
              }
              aria-label={dictating ? `Stop dictation in ${title}` : `Start dictation in ${title}`}
            >
              {dictationTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : dictating ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
            {isActive ? (
              <button
                type="button"
                onClick={() => void handleStop()}
                className="theme-muted-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                title="Stop response"
                aria-label={`Stop ${title}`}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={
                (!draft.trim() && pendingImages.length === 0 && pendingFiles.length === 0) ||
                sending ||
                (!isActive && responsePending)
              }
              className="accent-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-35"
              title={isActive ? "Queue follow-up" : "Send message"}
              aria-label={isActive ? `Queue follow-up in ${title}` : `Send message to ${title}`}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function EmptyMultiChatPane({
  dropActive,
  dropPreview,
  index,
  onCreateDraft,
  onOpenPicker,
}: {
  dropActive: boolean;
  dropPreview: boolean;
  index: number;
  onCreateDraft: (index: number) => void;
  onOpenPicker: (index: number) => void;
}) {
  return (
    <section
      className={cn(
        "theme-text-muted flex min-h-[24rem] min-w-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-[var(--surface-panel)] p-6 text-center transition-colors lg:min-h-0",
        dropActive
          ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.08)]"
          : dropPreview
            ? "border-[rgba(var(--accent-primary),0.42)] bg-[rgba(var(--accent-primary),0.025)]"
            : "border-[var(--surface-border)]"
      )}
      data-testid="multi-chat-empty-pane"
      data-multi-chat-drop-index={index}
      data-drop-active={dropActive}
      data-drop-preview={dropPreview}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-raised)]">
        <MessageSquarePlus className="h-5 w-5" />
      </span>
      <span>
        <span className="theme-text-primary block text-sm font-medium">Add a chat</span>
        <span className="mt-1 block text-xs">Search or drag a chat here from the sidebar</span>
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onCreateDraft(index)}
          className="accent-bg inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-white"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New chat
        </button>
        <button
          type="button"
          onClick={() => onOpenPicker(index)}
          className="theme-muted-icon-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs"
        >
          <Search className="h-3.5 w-3.5" />
          Existing
        </button>
      </span>
    </section>
  );
}

export function MultiChatWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: sessions = [] } = useSessions({ limit: 150 });
  const { data: agents = [] } = useAgentSummaries();
  const { data: routerConfig } = useQuery({
    queryKey: ["router", "config", "multi-chat"],
    queryFn: routerApi.config,
    staleTime: 60_000,
  });
  const { data: chatConfig } = useQuery({
    queryKey: ["config", "multi-chat"],
    queryFn: settingsApi.getConfig,
    staleTime: 60_000,
  });
  const initialRouteIds = parseMultiChatSessionIds(location.search);
  const [sessionIds, setSessionIds] = useState(() =>
    initialRouteIds.length ? initialRouteIds : readPersistedMultiChatSessionIds(window.localStorage)
  );
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  const [pickerTargetIndex, setPickerTargetIndex] = useState<number | null>(null);
  const [openEnvironmentIds, setOpenEnvironmentIds] = useState<Set<string>>(() => new Set());
  const [lightboxImage, setLightboxImage] = useState<ChatLightboxImage | null>(null);
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("ask");
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const initializedRef = useRef(false);
  const refreshTimersRef = useRef<Map<string, { includeSessionList: boolean; timer: number }>>(
    new Map()
  );

  useEffect(() => {
    if (!chatConfig?.success) return;
    setToolApprovalMode(normalizeToolApprovalMode(chatConfig.data?.tool_approval_mode));
  }, [chatConfig]);

  const updateToolApprovalMode = useCallback(
    async (nextMode: ToolApprovalMode): Promise<void> => {
      if (savingToolApprovalMode || nextMode === toolApprovalMode) return;
      const previousMode = toolApprovalMode;
      setToolApprovalMode(nextMode);
      setSavingToolApprovalMode(true);
      try {
        const response = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
        if (!response.success || response.data?.success !== true) {
          throw new Error(response.error || "Failed to update tool approvals");
        }
      } catch (error) {
        setToolApprovalMode(previousMode);
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Failed to update tool approvals"
          );
      } finally {
        setSavingToolApprovalMode(false);
      }
    },
    [savingToolApprovalMode, toolApprovalMode]
  );

  const syncSessionIds = useCallback(
    (nextValues: readonly string[], replace = true) => {
      const next = normalizeMultiChatSessionIds(nextValues);
      const nextSet = new Set(next);
      setSessionIds(next);
      setOpenEnvironmentIds((current) => {
        const retained = new Set([...current].filter((sessionId) => nextSet.has(sessionId)));
        return retained.size === current.size ? current : retained;
      });
      persistMultiChatSessionIds(window.localStorage, next);
      navigate(buildMultiChatPath(next), { replace });
    },
    [navigate]
  );

  useEffect(() => {
    const routeIds = parseMultiChatSessionIds(location.search);
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (!routeIds.length && sessionIds.length) {
        navigate(buildMultiChatPath(sessionIds), { replace: true });
      }
      return;
    }
    if (!arraysEqual(routeIds, sessionIds)) {
      setSessionIds(routeIds);
      persistMultiChatSessionIds(window.localStorage, routeIds);
    }
  }, [location.search, navigate, sessionIds]);

  const refreshSession = useCallback(
    (sessionId: string, includeSessionList = false) => {
      const existing = refreshTimersRef.current.get(sessionId);
      if (existing) {
        if (includeSessionList) existing.includeSessionList = true;
        return;
      }
      const timer = window.setTimeout(() => {
        const pending = refreshTimersRef.current.get(sessionId);
        refreshTimersRef.current.delete(sessionId);
        void queryClient.invalidateQueries({ queryKey: [SESSION_DETAIL_QUERY_KEY, sessionId] });
        if (pending?.includeSessionList) {
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        }
      }, MULTI_CHAT_REFRESH_THROTTLE_MS);
      refreshTimersRef.current.set(sessionId, { includeSessionList, timer });
    },
    [queryClient]
  );

  const statuses = useMultiChatLiveStatuses({ sessionIds, onRefresh: refreshSession });

  useEffect(
    () => () => {
      for (const pending of refreshTimersRef.current.values()) {
        window.clearTimeout(pending.timer);
      }
      refreshTimersRef.current.clear();
    },
    []
  );

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session as ChatSidebarSession])),
    [sessions]
  );
  const modelRouterEnabled = routerConfig?.success === true && routerConfig.data?.enabled === true;
  const allEnvironmentsOpen =
    sessionIds.length > 0 && sessionIds.every((sessionId) => openEnvironmentIds.has(sessionId));
  const addOrMoveSession = useCallback(
    (sessionId: string, targetIndex: number) => {
      const sourceIndex = sessionIds.indexOf(sessionId);
      if (sourceIndex >= 0) {
        syncSessionIds(reorderMultiChatSessions(sessionIds, sessionId, targetIndex));
        return;
      }
      if (sessionIds.length < MULTI_CHAT_MAX_PANES) {
        const added = addMultiChatSession(sessionIds, sessionId);
        syncSessionIds(reorderMultiChatSessions(added, sessionId, targetIndex));
        return;
      }
      syncSessionIds(replaceMultiChatSession(sessionIds, targetIndex, sessionId));
    },
    [sessionIds, syncSessionIds]
  );

  const dropTarget = useMultiChatDropTarget({
    onDropSession: addOrMoveSession,
    onTargetChange: setActiveDropIndex,
  });
  const slotCount = resolveMultiChatSlotCount(sessionIds.length, dropTarget.active);

  useEffect(() => {
    const clearDropTarget = (): void => dropTarget.clear();
    window.addEventListener("dragend", clearDropTarget, true);
    window.addEventListener("blur", clearDropTarget);
    return () => {
      window.removeEventListener("dragend", clearDropTarget, true);
      window.removeEventListener("blur", clearDropTarget);
    };
  }, [dropTarget.clear]);

  const selectFromPicker = (sessionId: string) => {
    const targetIndex = pickerTargetIndex ?? sessionIds.length;
    addOrMoveSession(sessionId, targetIndex);
    setPickerTargetIndex(null);
  };

  const createDraftAt = useCallback(
    (targetIndex: number) => {
      const draftId = createMultiChatDraftId();
      if (sessionIds.length < MULTI_CHAT_MAX_PANES) {
        const added = addMultiChatSession(sessionIds, draftId);
        syncSessionIds(reorderMultiChatSessions(added, draftId, targetIndex));
        return;
      }
      syncSessionIds(replaceMultiChatSession(sessionIds, targetIndex, draftId));
    },
    [sessionIds, syncSessionIds]
  );

  const replacePaneSessionId = useCallback(
    (previousSessionId: string, nextSessionId: string) => {
      const index = sessionIds.indexOf(previousSessionId);
      if (index < 0) return;
      const next = replaceMultiChatSession(sessionIds, index, nextSessionId);
      const environmentWasOpen = openEnvironmentIds.has(previousSessionId);
      syncSessionIds(next);
      if (environmentWasOpen) {
        setOpenEnvironmentIds((current) => {
          const updated = new Set(current);
          updated.delete(previousSessionId);
          updated.add(nextSessionId);
          return updated;
        });
      }
    },
    [openEnvironmentIds, sessionIds, syncSessionIds]
  );

  const toggleEnvironment = useCallback((sessionId: string) => {
    setOpenEnvironmentIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const toggleAllEnvironments = useCallback(() => {
    setOpenEnvironmentIds(allEnvironmentsOpen ? new Set() : new Set(sessionIds));
  }, [allEnvironmentsOpen, sessionIds]);

  return (
    <div
      className="flex h-screen min-h-0 flex-col bg-[var(--surface-backdrop)]"
      data-testid="multi-chat-workspace"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--surface-border)] px-3 sm:px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-raised)]">
          <LayoutGrid className="h-4 w-4 text-[var(--icon-muted)]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="theme-text-primary block text-sm font-semibold">Multi-chat</span>
          <span className="theme-text-muted block text-[11px]">
            {sessionIds.length} of {MULTI_CHAT_MAX_PANES} chats open
          </span>
        </span>
        <button
          type="button"
          onClick={() => createDraftAt(sessionIds.length)}
          disabled={sessionIds.length >= MULTI_CHAT_MAX_PANES}
          className="theme-muted-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40"
          title="New chat"
          aria-label="New chat"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPickerTargetIndex(sessionIds.length)}
          disabled={sessionIds.length >= MULTI_CHAT_MAX_PANES}
          className="theme-muted-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40"
          title="Add existing chat"
          aria-label="Add existing chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleAllEnvironments}
          disabled={sessionIds.length === 0}
          className={cn(
            "theme-muted-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40",
            allEnvironmentsOpen && "bg-[var(--surface-hover)] text-[var(--text-primary)]"
          )}
          aria-pressed={allEnvironmentsOpen}
          title={allEnvironmentsOpen ? "Hide all environments" : "Show all environments"}
          aria-label={allEnvironmentsOpen ? "Hide all environments" : "Show all environments"}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() =>
            navigate(sessionIds[0] ? `/chat?session=${encodeURIComponent(sessionIds[0])}` : "/chat")
          }
          className="theme-muted-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md"
          title="Open single chat"
          aria-label="Open single chat"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </header>

      <main
        className={cn(
          "grid min-h-0 flex-1 gap-2 overflow-y-auto p-2 lg:overflow-hidden",
          slotCount === 2
            ? "grid-cols-1 lg:grid-cols-2"
            : "grid-cols-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
        )}
        data-drop-preview={dropTarget.active}
        onDragEnter={dropTarget.onDragEnter}
        onDragLeave={dropTarget.onDragLeave}
        onDragOver={dropTarget.onDragOver}
        onDrop={dropTarget.onDrop}
      >
        {Array.from({ length: slotCount }, (_, index) => {
          const sessionId = sessionIds[index];
          return sessionId ? (
            <MultiChatPane
              key={sessionId}
              agents={agents}
              approvalMode={toolApprovalMode}
              approvalUpdating={savingToolApprovalMode}
              dropActive={activeDropIndex === index}
              dropPreview={dropTarget.active}
              environmentOpen={openEnvironmentIds.has(sessionId)}
              index={index}
              modelRouterEnabled={modelRouterEnabled}
              sessionId={sessionId}
              summary={sessionById.get(sessionId)}
              status={statuses[sessionId]}
              onApprovalChange={(mode) => void updateToolApprovalMode(mode)}
              onOpenPicker={setPickerTargetIndex}
              onOpenImage={(src, alt) => setLightboxImage({ src, alt })}
              onRemove={(removedId) =>
                syncSessionIds(sessionIds.filter((value) => value !== removedId))
              }
              onReplaceSession={replacePaneSessionId}
              onRefresh={refreshSession}
              onToggleEnvironment={toggleEnvironment}
            />
          ) : (
            <EmptyMultiChatPane
              key={`empty-${index}`}
              dropActive={activeDropIndex === index}
              dropPreview={dropTarget.active}
              index={index}
              onCreateDraft={createDraftAt}
              onOpenPicker={setPickerTargetIndex}
            />
          );
        })}
      </main>

      <MultiChatPicker
        isOpen={pickerTargetIndex !== null}
        sessions={sessions as ChatSidebarSession[]}
        selectedIds={sessionIds}
        onClose={() => setPickerTargetIndex(null)}
        onSelect={selectFromPicker}
      />
      {lightboxImage ? (
        <ChatImageLightbox
          images={[lightboxImage]}
          initialIndex={0}
          onClose={() => setLightboxImage(null)}
        />
      ) : null}
    </div>
  );
}
