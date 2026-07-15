import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { settingsApi, chatApi } from "@/lib/api";
import type { PendingChatMessage } from "@/lib/status-stream";
import { useUIStore } from "@/stores/uiStore";
import type { AgentReasoningEffort, AgentSummary, ChatImageAttachment } from "@/types";
import { ChatComposer } from "../chat/ChatComposer";
import { normalizeToolApprovalMode, type ToolApprovalMode } from "../chat/ChatFollowUpControls";
import { MODEL_ROUTER_SELECTOR_VALUE } from "../chat/ChatAgentControls";
import { normalizePendingChatMessages } from "../chat/pendingQueueState";
import { useChatAttachments } from "../chat/useChatAttachments";
import { useChatCapabilityPicker } from "../chat/useChatCapabilityPicker";
import { useChatDictation } from "../chat/useChatDictation";

export interface IdeChatComposerSubmission {
  clientPendingId?: string;
  images: ChatImageAttachment[];
  message: string;
  queueMode?: "queue";
}

export interface IdeChatComposerResult {
  pendingMessages?: PendingChatMessage[];
  queued?: boolean;
}

interface IDEChatComposerProps {
  active: boolean;
  activeAgent?: AgentSummary;
  agents: AgentSummary[];
  contextUsage: Parameters<typeof ChatComposer>[0]["contextUsage"];
  disabled: boolean;
  input: string;
  isLoading: boolean;
  isStopping: boolean;
  modelRouterEnabled: boolean;
  providerPlan: Parameters<typeof ChatComposer>[0]["providerPlan"];
  reasoningUpdating: boolean;
  selectedAgentId?: string;
  sessionId: string | null;
  useModelRouter: boolean;
  workspaceDir: string;
  setInput: Dispatch<SetStateAction<string>>;
  onReasoningChange: (effort: AgentReasoningEffort | null) => void;
  onRefreshSession: () => void | Promise<void>;
  onSelectAgent: (agentId?: string) => void;
  onStop: () => void;
  onSubmit: (submission: IdeChatComposerSubmission) => Promise<IdeChatComposerResult>;
}

export function IDEChatComposer({
  active,
  activeAgent,
  agents,
  contextUsage,
  disabled,
  input,
  isLoading,
  isStopping,
  modelRouterEnabled,
  providerPlan,
  reasoningUpdating,
  selectedAgentId,
  sessionId,
  useModelRouter,
  workspaceDir,
  setInput,
  onReasoningChange,
  onRefreshSession,
  onSelectAgent,
  onStop,
  onSubmit,
}: IDEChatComposerProps) {
  const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>("always_allow");
  const [approvalUpdating, setApprovalUpdating] = useState(false);
  const [followUpBehaviorEnabled, setFollowUpBehaviorEnabled] = useState(true);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [mutatingMessageId, setMutatingMessageId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  const addToast = useUIStore((state) => state.addToast);
  const attachments = useChatAttachments();
  const dictation = useChatDictation(setInput);
  const capabilityPicker = useChatCapabilityPicker({
    input,
    setInput,
    inputRef,
    workspaceDir,
    onSend: () => submitRef.current(),
  });

  const refreshPendingMessages = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      setPendingMessages([]);
      return;
    }
    const response = await chatApi.getPendingMessages(sessionId);
    if (response.success && response.data) {
      setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
    }
  }, [sessionId]);

  useEffect(() => {
    let mounted = true;
    void settingsApi.getConfig().then((result) => {
      if (!mounted || !result.success) return;
      setApprovalMode(normalizeToolApprovalMode(result.data?.tool_approval_mode));
      setFollowUpBehaviorEnabled(result.data?.follow_up_behavior_enabled !== false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void refreshPendingMessages();
    if (!sessionId || (!active && pendingMessages.length === 0)) return;
    const interval = window.setInterval(() => void refreshPendingMessages(), 2000);
    return () => window.clearInterval(interval);
  }, [active, pendingMessages.length, refreshPendingMessages, sessionId]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [input]);

  const handleApprovalChange = useCallback(
    async (nextMode: ToolApprovalMode): Promise<void> => {
      if (approvalUpdating || nextMode === approvalMode) return;
      const previousMode = approvalMode;
      setApprovalMode(nextMode);
      setApprovalUpdating(true);
      try {
        const result = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
        if (!result.success || !result.data?.success)
          throw new Error(result.error || "Update failed");
        addToast("success", "Tool approval mode updated");
      } catch (error) {
        setApprovalMode(previousMode);
        addToast("error", error instanceof Error ? error.message : "Failed to update approvals");
      } finally {
        setApprovalUpdating(false);
      }
    },
    [addToast, approvalMode, approvalUpdating]
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    const hasAttachments =
      attachments.pendingImages.length > 0 || attachments.pendingFiles.length > 0;
    if ((!input.trim() && !hasAttachments) || disabled) return;
    const queued = active || pendingMessages.length > 0;
    if (queued && !followUpBehaviorEnabled) return;
    const consumed = attachments.consumeAttachments(input);
    const clientPendingId = queued ? `ide-${Date.now()}-${crypto.randomUUID()}` : undefined;
    setInput("");
    if (queued && sessionId && clientPendingId) {
      const now = Date.now();
      setPendingMessages((previous) =>
        normalizePendingChatMessages([
          ...previous,
          {
            id: clientPendingId,
            sessionId,
            clientPendingId,
            content: consumed.message,
            createdAt: now,
            updatedAt: now,
            mode: "queued",
            sequence: previous.reduce((max, item) => Math.max(max, item.sequence || 0), 0) + 1,
          },
        ])
      );
    }
    try {
      const result = await onSubmit({
        clientPendingId,
        images: consumed.images,
        message: consumed.message,
        queueMode: queued ? "queue" : undefined,
      });
      if (result.pendingMessages) {
        setPendingMessages(normalizePendingChatMessages(result.pendingMessages));
      }
    } catch (error) {
      if (clientPendingId) {
        setPendingMessages((previous) => previous.filter((item) => item.id !== clientPendingId));
      }
      setInput((current) => current || consumed.message);
      addToast("error", error instanceof Error ? error.message : "Failed to send message");
    }
  }, [
    active,
    addToast,
    attachments,
    disabled,
    followUpBehaviorEnabled,
    input,
    onSubmit,
    pendingMessages.length,
    setInput,
    sessionId,
  ]);
  useEffect(() => {
    submitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleSteer = useCallback(
    async (pendingMessageId: string): Promise<void> => {
      if (!sessionId) return;
      setSteeringMessageId(pendingMessageId);
      try {
        const response = await chatApi.steerPendingMessage(sessionId, pendingMessageId);
        if (response.success && response.data) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          await onRefreshSession();
        }
      } finally {
        setSteeringMessageId(null);
      }
    },
    [onRefreshSession, sessionId]
  );

  const handleReorder = useCallback(
    async (ids: string[]): Promise<void> => {
      if (!sessionId) return;
      const response = await chatApi.reorderPendingMessages(sessionId, ids);
      if (response.success && response.data?.pendingMessages) {
        setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
      }
    },
    [sessionId]
  );

  const handleUpdate = useCallback(
    async (id: string, content: string): Promise<void> => {
      if (!sessionId || id.startsWith("ide-")) return;
      setMutatingMessageId(id);
      try {
        const response = await chatApi.updatePendingMessage(sessionId, id, content);
        if (response.success && response.data?.pendingMessages) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
        }
      } finally {
        setMutatingMessageId(null);
      }
    },
    [sessionId]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!sessionId) return;
      if (id.startsWith("ide-")) {
        setPendingMessages((previous) => previous.filter((item) => item.id !== id));
        return;
      }
      setMutatingMessageId(id);
      try {
        const response = await chatApi.deletePendingMessage(sessionId, id);
        if (response.success && response.data?.pendingMessages) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
        }
      } finally {
        setMutatingMessageId(null);
      }
    },
    [sessionId]
  );

  const selectedId = useModelRouter ? MODEL_ROUTER_SELECTOR_VALUE : selectedAgentId;
  const composerHasDraft =
    input.trim().length > 0 ||
    attachments.pendingImages.length > 0 ||
    attachments.pendingFiles.length > 0;
  const dictationLabel = dictation.runtime.label || "Dictation";

  return (
    <ChatComposer
      activeAgent={activeAgent}
      agents={agents}
      agentUpdating={false}
      approvalMode={approvalMode}
      approvalUpdating={approvalUpdating}
      capabilityPicker={capabilityPicker}
      composerHasDraft={composerHasDraft}
      composerRef={composerRef}
      contextUsage={contextUsage}
      currentPlan={null}
      currentPlanKey={null}
      dictating={dictation.dictating}
      dictationEngine={dictation.runtime.engine}
      dictationError={dictation.error}
      dictationLabel={dictationLabel}
      dictationStatus={dictation.status}
      dictationTranscribing={dictation.transcribing}
      dictationUnsupportedReason={dictation.runtime.unsupportedReason}
      followUpBehaviorEnabled={followUpBehaviorEnabled}
      imageDragActive={attachments.imageDragActive}
      imageInputRef={imageInputRef}
      input={input}
      inputRef={inputRef}
      isLoading={isLoading}
      isStopping={isStopping}
      modelRouterEnabled={modelRouterEnabled}
      mutatingMessageId={mutatingMessageId}
      pendingFiles={attachments.pendingFiles}
      pendingImages={attachments.pendingImages}
      pendingMessages={pendingMessages}
      placeholder="Ask about this workspace..."
      providerPlan={providerPlan}
      queueing={active || pendingMessages.length > 0}
      reasoningUpdating={reasoningUpdating}
      selectedAgentId={selectedId}
      showPlan={false}
      showStop={active}
      showWorkingTimeline={active}
      steeringMessageId={steeringMessageId}
      useModelRouter={useModelRouter}
      onAddAttachmentFiles={attachments.addAttachmentFiles}
      onApprovalChange={(mode) => void handleApprovalChange(mode)}
      onDeletePendingMessage={(id) => void handleDelete(id)}
      onDismissPlan={() => undefined}
      onDragActiveChange={attachments.setImageDragActive}
      onDrop={attachments.handleComposerDrop}
      onPaste={attachments.handleComposerPaste}
      onReasoningChange={onReasoningChange}
      onRemovePendingFile={attachments.removePendingFile}
      onRemovePendingImage={attachments.removePendingImage}
      onReorderPendingMessages={(ids) => void handleReorder(ids)}
      onSelectAgent={onSelectAgent}
      onSend={handleSubmit}
      onSteerPendingMessage={(id) => void handleSteer(id)}
      onStop={onStop}
      onToggleDictation={() => void dictation.handleToggle()}
      onUpdatePendingMessage={(id, content) => void handleUpdate(id, content)}
    />
  );
}
