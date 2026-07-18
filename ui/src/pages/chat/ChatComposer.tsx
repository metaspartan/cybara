import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  X,
} from "lucide-react";
import type { ClipboardEvent, DragEvent, RefObject } from "react";
import type { ChatHorizontalPadding } from "../../../../shared/chat-appearance";
import type { ChatFileAttachment } from "@/lib/chatImages";
import {
  chatImageSrc,
  formatBytes,
  imageAttachmentBytes,
  MAX_CHAT_IMAGES,
  mediaSummaryLabel,
} from "@/lib/chatImages";
import type { PendingChatMessage } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import type {
  AgentReasoningEffort,
  AgentSummary,
  ChatImageAttachment,
  ProviderPlanSnapshot,
  SessionContextUsage,
} from "@/types";
import { ChatAgentControls } from "./ChatAgentControls";
import { ChatCapabilityMenu } from "./ChatCapabilityMenu";
import { ChatComposerActionButton } from "./ChatComposerActionButton";
import {
  ChatApprovalControls,
  PendingChatQueue,
  type ToolApprovalMode,
} from "./ChatFollowUpControls";
import { ChatReasoningControl } from "./ChatReasoningControl";
import { chatHorizontalPaddingClassName } from "./chatAppearanceLayout";
import type { SessionPlanView } from "./chatModel";
import { PlanSummaryCard } from "./PlanSummaryCard";
import type { useChatCapabilityPicker } from "./useChatCapabilityPicker";

export interface ChatComposerProps {
  activeAgent?: AgentSummary;
  agents: AgentSummary[];
  agentUpdating: boolean;
  approvalMode: ToolApprovalMode;
  approvalUpdating: boolean;
  capabilityPicker: ReturnType<typeof useChatCapabilityPicker>;
  composerHasDraft: boolean;
  composerRef: RefObject<HTMLDivElement | null>;
  contextUsage: SessionContextUsage | null;
  currentPlan: SessionPlanView | null;
  currentPlanKey: string | null;
  dictating: boolean;
  dictationEngine: string | null;
  dictationError: string | null;
  dictationLabel: string;
  dictationStatus: string | null;
  dictationTranscribing: boolean;
  dictationUnsupportedReason: string | null;
  followUpBehaviorEnabled: boolean;
  imageDragActive: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  horizontalPadding: ChatHorizontalPadding;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  isStopping: boolean;
  layout?: "default" | "new-chat";
  modelRouterEnabled: boolean;
  mutatingMessageId: string | null;
  pendingFiles: ChatFileAttachment[];
  pendingImages: ChatImageAttachment[];
  pendingMessages: PendingChatMessage[];
  placeholder: string;
  providerPlan: ProviderPlanSnapshot | null;
  queueing: boolean;
  reasoningUpdating: boolean;
  selectedAgentId?: string;
  showPlan: boolean;
  showStop: boolean;
  showWorkingTimeline: boolean;
  steeringMessageId: string | null;
  useModelRouter: boolean;
  onAddAttachmentFiles: (files: Iterable<File>) => void | Promise<void>;
  onApprovalChange: (mode: ToolApprovalMode) => void;
  onDeletePendingMessage: (id: string) => void;
  onDismissPlan: () => void;
  onDragActiveChange: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onReasoningChange: (effort: AgentReasoningEffort | null) => void;
  onRemovePendingFile: (index: number) => void;
  onRemovePendingImage: (index: number) => void;
  onReorderPendingMessages: (orderedIds: string[]) => void;
  onSelectAgent: (agentId?: string) => void;
  onSend: () => void | Promise<void>;
  onSteerPendingMessage: (id: string) => void;
  onStop: () => void;
  onToggleDictation: () => void;
  onUpdatePendingMessage: (id: string, content: string) => void;
}

export function ChatComposer({
  activeAgent,
  agents,
  agentUpdating,
  approvalMode,
  approvalUpdating,
  capabilityPicker,
  composerHasDraft,
  composerRef,
  contextUsage,
  currentPlan,
  currentPlanKey,
  dictating,
  dictationEngine,
  dictationError,
  dictationLabel,
  dictationStatus,
  dictationTranscribing,
  dictationUnsupportedReason,
  followUpBehaviorEnabled,
  imageDragActive,
  imageInputRef,
  horizontalPadding,
  input,
  inputRef,
  isLoading,
  isStopping,
  layout = "default",
  modelRouterEnabled,
  mutatingMessageId,
  pendingFiles,
  pendingImages,
  pendingMessages,
  placeholder,
  providerPlan,
  queueing,
  reasoningUpdating,
  selectedAgentId,
  showPlan,
  showStop,
  showWorkingTimeline,
  steeringMessageId,
  useModelRouter,
  onAddAttachmentFiles,
  onApprovalChange,
  onDeletePendingMessage,
  onDismissPlan,
  onDragActiveChange,
  onDrop,
  onPaste,
  onReasoningChange,
  onRemovePendingFile,
  onRemovePendingImage,
  onReorderPendingMessages,
  onSelectAgent,
  onSend,
  onSteerPendingMessage,
  onStop,
  onToggleDictation,
  onUpdatePendingMessage,
}: ChatComposerProps) {
  return (
    <div
      ref={composerRef}
      data-layout={layout}
      className={cn(
        "chat-composer-responsive flex-shrink-0",
        layout === "new-chat"
          ? "w-full bg-transparent p-0"
          : cn(
              "w-full border-t border-white/5 bg-[#0a0a0f]/80 py-3 backdrop-blur-xl",
              chatHorizontalPaddingClassName(horizontalPadding)
            )
      )}
    >
      {showPlan && currentPlan && currentPlanKey ? (
        <PlanSummaryCard
          plan={currentPlan}
          compact
          dismissible
          expandable
          onDismiss={onDismissPlan}
        />
      ) : null}
      <PendingChatQueue
        messages={pendingMessages}
        onSteer={onSteerPendingMessage}
        onReorder={onReorderPendingMessages}
        onUpdate={onUpdatePendingMessage}
        onDelete={onDeletePendingMessage}
        steeringMessageId={steeringMessageId}
        mutatingMessageId={mutatingMessageId}
      />
      {dictationError || dictationStatus ? (
        <div
          className={cn(
            "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
            dictationError
              ? "border-red-500/25 bg-red-500/10 text-red-200"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
          )}
          role={dictationError ? "alert" : "status"}
        >
          {dictationError ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : dictating ? (
            <Mic className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{dictationError || dictationStatus}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "chat-composer-surface relative rounded-[22px] border px-3 py-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-colors",
          imageDragActive && "border-[rgba(var(--accent-primary),0.6)]"
        )}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file")) {
            event.preventDefault();
            onDragActiveChange(true);
          }
        }}
        onDragLeave={() => onDragActiveChange(false)}
        onDrop={onDrop}
      >
        {pendingImages.length > 0 || pendingFiles.length > 0 ? (
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-400">
              <Paperclip className="h-3 w-3 shrink-0" />
              <span>{mediaSummaryLabel(pendingImages, pendingFiles)}</span>
              {pendingImages.length >= MAX_CHAT_IMAGES ? (
                <span className="text-amber-300/80">· max {MAX_CHAT_IMAGES} images</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingImages.map((image, index) => (
                <div
                  key={`pending-image-${index}`}
                  className="group relative h-16 w-16 overflow-hidden rounded-lg border border-white/12"
                  title={`${image.name || "image"}${
                    imageAttachmentBytes(image)
                      ? ` · ${formatBytes(imageAttachmentBytes(image))}`
                      : ""
                  }`}
                >
                  <img
                    src={chatImageSrc(image)}
                    alt={image.name || "Attachment preview"}
                    className="h-full w-full object-cover"
                  />
                  {imageAttachmentBytes(image) > 0 ? (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-px text-[9px] leading-tight text-white/90">
                      {formatBytes(imageAttachmentBytes(image))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemovePendingImage(index)}
                    className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {pendingFiles.map((file, index) => (
                <div
                  key={`pending-file-${index}`}
                  className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2 py-1 text-xs text-gray-200"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    {formatBytes(file.size) ? (
                      <span className="text-[10px] text-gray-500">{formatBytes(file.size)}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemovePendingFile(index)}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
                    aria-label="Remove file"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.json,.jsonc,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.log,.html,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cc,.cs,.php,.sh,.bash,.zsh,.sql,.env,.vue,.svelte"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void onAddAttachmentFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <textarea
          ref={inputRef}
          data-chat-composer-input="true"
          value={input}
          onChange={capabilityPicker.onChange}
          onKeyDown={capabilityPicker.onKeyDown}
          onClick={(event) => capabilityPicker.onCursorChange(event.currentTarget.selectionStart)}
          onKeyUp={(event) => capabilityPicker.onCursorChange(event.currentTarget.selectionStart)}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          className="w-full min-h-[38px] max-h-[220px] overflow-y-auto resize-none bg-transparent px-0 py-1 text-[13px] leading-5 text-[var(--text-primary)] !outline-none"
        />
        {capabilityPicker.menuOpen ? (
          <ChatCapabilityMenu
            options={capabilityPicker.options}
            selectedIndex={capabilityPicker.selectedIndex}
            loading={capabilityPicker.loading}
            onSelect={capabilityPicker.select}
          />
        ) : null}
        <div className="mt-0.5 flex min-h-8 items-center gap-1.5">
          <ChatApprovalControls
            mode={approvalMode}
            onChange={onApprovalChange}
            updating={approvalUpdating}
          />
          <div className="min-w-0 flex-1" />
          <ChatAgentControls
            agents={agents}
            selectedAgentId={selectedAgentId}
            modelRouterEnabled={modelRouterEnabled}
            useModelRouter={useModelRouter}
            contextUsage={contextUsage}
            providerPlan={providerPlan}
            onSelectAgent={onSelectAgent}
            updating={agentUpdating}
          />
          <ChatReasoningControl
            effort={activeAgent?.reasoning_effort}
            provider={
              activeAgent?.provider_type ?? activeAgent?.provider ?? activeAgent?.provider_id
            }
            model={activeAgent?.model}
            disabled={useModelRouter || !activeAgent}
            updating={reasoningUpdating}
            onChange={onReasoningChange}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="composer-icon-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach image or file"
            aria-label="Attach image or file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleDictation}
            disabled={showWorkingTimeline || dictationTranscribing}
            className={cn(
              "composer-icon-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
              dictating
                ? "bg-red-500/20 text-red-300"
                : !dictationEngine
                  ? "text-amber-200 hover:bg-amber-500/15"
                  : ""
            )}
            title={
              dictationTranscribing
                ? "Transcribing..."
                : dictating
                  ? "Stop dictation"
                  : dictationEngine
                    ? `Start ${dictationLabel.toLowerCase()}`
                    : dictationUnsupportedReason || "Dictation unavailable"
            }
            aria-label={
              dictationTranscribing
                ? "Transcribing dictation"
                : dictating
                  ? "Stop dictation"
                  : dictationEngine
                    ? `Start ${dictationLabel.toLowerCase()}`
                    : "Show dictation support issue"
            }
          >
            {dictationTranscribing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : dictating ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
          <ChatComposerActionButton
            disabled={
              !composerHasDraft ||
              (showWorkingTimeline && !followUpBehaviorEnabled) ||
              (isLoading && !queueing)
            }
            isStopping={isStopping}
            onSend={onSend}
            onStop={onStop}
            queueing={queueing}
            showStop={showStop}
          />
        </div>
      </div>
    </div>
  );
}
