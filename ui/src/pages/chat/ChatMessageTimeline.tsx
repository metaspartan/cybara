import {
  Check,
  Copy,
  FlaskConical,
  GitFork,
  Loader2,
  RotateCcw,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ReactElement } from "react";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
  suppressRecoveredWebFailureActivities,
} from "@/lib/chatActivities";
import { chatImageSrc, toolOutputImageSources } from "@/lib/chatImages";
import { cn, formatRelativeTime } from "@/lib/utils";
import { LiveActivityTimeline } from "./ActivityTimeline";
import { AgentTransferTimeline } from "./AgentTransferTimeline";
import { AssistantMetaInline } from "./AssistantMetaInline";
import { parseTimestampMs } from "./assistantMetaModel";
import type { ArtifactSummaryView, ChatMessage, RevertTarget } from "./chatModel";
import {
  formatToolIntent,
  getMessageProcessActivities,
  normalizeMessageProcessActivities,
} from "./chatModel";
import { MessageContent } from "./MessageContent";

interface VisibleMessageEntry {
  message: ChatMessage;
  originalIndex: number;
  turnStartedAtMs?: number;
}

interface ChatMessageTimelineProps {
  copiedMessageIndex: number | null;
  entries: VisibleMessageEntry[];
  forkingMessageIndex: number | null;
  liveActivities: LiveActivityItem[];
  liveCurrentStep: string | null;
  liveStatus: "thinking" | "generating" | "compacting" | "idle";
  liveStartedAtMs?: number;
  messageProcessMap: Record<string, LiveActivityItem[]>;
  savingGoldenMessageIndex: number | null;
  sessionId: string | null;
  showWorkingTimeline: boolean;
  speakingMessageIndex: number | null;
  workspaceDir: string | null;
  onCopyMessage: (index: number, content: string) => void;
  onForkSession: (index: number) => void;
  onOpenArtifact: (artifact: ArtifactSummaryView) => void;
  onOpenImage: (src: string, alt: string) => void;
  onReadAloud: (index: number, content: string) => void;
  onRevert: (target: RevertTarget) => void;
  onSaveGolden: (index: number) => void;
}

export function ChatMessageTimeline({
  copiedMessageIndex,
  entries,
  forkingMessageIndex,
  liveActivities,
  liveCurrentStep,
  liveStatus,
  liveStartedAtMs,
  messageProcessMap,
  savingGoldenMessageIndex,
  sessionId,
  showWorkingTimeline,
  speakingMessageIndex,
  workspaceDir,
  onCopyMessage,
  onForkSession,
  onOpenArtifact,
  onOpenImage,
  onReadAloud,
  onRevert,
  onSaveGolden,
}: ChatMessageTimelineProps): ReactElement {
  return (
    <>
      {entries.map(({ message, originalIndex, turnStartedAtMs }) => {
        const persistedProcessActivities = getMessageProcessActivities(
          messageProcessMap,
          sessionId,
          message,
          originalIndex
        );
        const embeddedProcessActivities = normalizeMessageProcessActivities(
          message.process_activities,
          parseTimestampMs(message.timestamp) ?? turnStartedAtMs
        );
        const restoredProcessActivities = mergeActivityLists(
          persistedProcessActivities,
          embeddedProcessActivities
        );
        const fallbackToolActivities =
          restoredProcessActivities.length === 0
            ? buildActivitiesFromToolCalls(message.tool_calls, formatToolIntent, {
                baseTimestampMs: parseTimestampMs(message.timestamp) ?? turnStartedAtMs ?? 0,
              })
            : [];
        const mergedActivities = suppressRecoveredWebFailureActivities(
          mergeActivityLists(restoredProcessActivities, fallbackToolActivities),
          message.tool_calls
        );
        const processActivities =
          mergedActivities.length > 0 ? finalizeCompletedActivities(mergedActivities) : undefined;
        return (
          <div
            key={`${message.timestamp || "msg"}-${originalIndex}`}
            className={cn(
              "deferred-chat-message flex gap-3",
              message.role === "user" && "flex-row-reverse"
            )}
          >
            {message.role === "user" && (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(var(--accent-primary),0.2)] sm:h-8 sm:w-8">
                <User className="h-3.5 w-3.5 accent-text sm:h-4 sm:w-4" />
              </div>
            )}
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] text-right sm:max-w-[75%] lg:max-w-[65%]"
                  : "w-full min-w-0"
              }
            >
              <div
                className={
                  message.role === "user"
                    ? "rounded-xl border border-[rgba(var(--accent-primary),0.2)] px-3 py-2 sm:rounded-2xl sm:px-4 sm:py-3"
                    : "py-1"
                }
              >
                {message.role !== "user" && (
                  <AssistantMetaInline
                    message={message}
                    processActivities={processActivities}
                    sessionId={sessionId}
                    turnStartedAtMs={turnStartedAtMs}
                    onOpenArtifact={onOpenArtifact}
                    section="work"
                    workspaceDir={workspaceDir}
                  />
                )}
                <AgentTransferTimeline transfers={message.agent_transfers} />
                {message.images && message.images.length > 0 && (
                  <div
                    className={cn(
                      "flex flex-wrap gap-2",
                      message.content && "mb-2",
                      message.role === "user" && "justify-end"
                    )}
                  >
                    {message.images.map((image, imageIndex) => {
                      const src = chatImageSrc(image);
                      if (!src) return null;
                      const alt = image.name || "Attachment";
                      return (
                        <button
                          type="button"
                          key={`msg-image-${originalIndex}-${imageIndex}`}
                          onClick={() => onOpenImage(src, alt)}
                          data-chat-lightbox-src={src}
                          data-chat-lightbox-alt={alt}
                          className="block max-w-[220px] cursor-zoom-in overflow-hidden rounded-lg border border-white/12"
                          aria-label={`Open ${alt} preview`}
                        >
                          <img
                            src={src}
                            alt="Attachment"
                            loading="lazy"
                            className="h-auto max-h-64 w-full object-contain"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
                <MessageContent content={message.content} onOpenImage={onOpenImage} />
                {message.role !== "user" && (
                  <ToolOutputImages
                    message={message}
                    messageIndex={originalIndex}
                    onOpenImage={onOpenImage}
                  />
                )}
                {message.role !== "user" && (
                  <AssistantMetaInline
                    message={message}
                    processActivities={processActivities}
                    sessionId={sessionId}
                    turnStartedAtMs={turnStartedAtMs}
                    onOpenArtifact={onOpenArtifact}
                    section="summary"
                    workspaceDir={workspaceDir}
                  />
                )}
              </div>

              <div
                className={cn(
                  "mt-1.5 flex items-center gap-1.5",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.timestamp && (
                  <span className="text-[10px] text-gray-600">
                    {formatRelativeTime(message.timestamp)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onCopyMessage(originalIndex, message.content)}
                  className="chat-message-action cursor-pointer rounded-md p-1"
                  title="Copy message"
                  aria-label="Copy message"
                >
                  {copiedMessageIndex === originalIndex ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                {message.role === "assistant" && message.content.trim() && (
                  <button
                    type="button"
                    onClick={() => onReadAloud(originalIndex, message.content)}
                    className="chat-message-action cursor-pointer rounded-md p-1"
                    title={
                      speakingMessageIndex === originalIndex ? "Stop reading aloud" : "Read aloud"
                    }
                    aria-label={
                      speakingMessageIndex === originalIndex ? "Stop reading aloud" : "Read aloud"
                    }
                  >
                    {speakingMessageIndex === originalIndex ? (
                      <VolumeX className="h-3 w-3" />
                    ) : (
                      <Volume2 className="h-3 w-3" />
                    )}
                  </button>
                )}
                {sessionId && (
                  <button
                    type="button"
                    onClick={() => onForkSession(originalIndex)}
                    disabled={forkingMessageIndex !== null}
                    className="chat-message-action cursor-pointer rounded-md p-1 disabled:opacity-50"
                    title="Fork chat from this message"
                    aria-label="Fork chat from this message"
                  >
                    {forkingMessageIndex === originalIndex ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <GitFork className="h-3 w-3" />
                    )}
                  </button>
                )}
                {message.role === "assistant" && sessionId && (
                  <button
                    type="button"
                    onClick={() => onSaveGolden(originalIndex)}
                    disabled={savingGoldenMessageIndex !== null}
                    className="chat-message-action cursor-pointer rounded-md p-1 disabled:opacity-50"
                    title="Save turn as golden test"
                    aria-label="Save turn as golden test"
                  >
                    {savingGoldenMessageIndex === originalIndex ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FlaskConical className="h-3 w-3" />
                    )}
                  </button>
                )}
                {message.role === "user" && sessionId && (
                  <button
                    type="button"
                    onClick={() =>
                      onRevert({
                        index: originalIndex,
                        content: message.content,
                        timestamp: message.timestamp,
                      })
                    }
                    className="chat-message-action cursor-pointer rounded-md p-1"
                    title="Revert session to this message"
                    aria-label="Revert session to this message"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {showWorkingTimeline && (
        <div className="w-full min-w-0 py-1">
          <LiveActivityTimeline
            status={liveStatus}
            activities={liveActivities}
            currentStep={liveCurrentStep}
            startedAtMs={liveStartedAtMs}
          />
        </div>
      )}
    </>
  );
}

function ToolOutputImages({
  message,
  messageIndex,
  onOpenImage,
}: {
  message: ChatMessage;
  messageIndex: number;
  onOpenImage: (src: string, alt: string) => void;
}): ReactElement | null {
  const outputImages = toolOutputImageSources(message.tool_calls || [], message.content);
  if (outputImages.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {outputImages.map((src, imageIndex) => (
        <button
          type="button"
          key={`tool-image-${messageIndex}-${imageIndex}`}
          onClick={() => onOpenImage(src, "Tool output")}
          data-chat-lightbox-src={src}
          data-chat-lightbox-alt="Tool output"
          className="block max-w-[320px] cursor-zoom-in overflow-hidden rounded-lg border border-white/12"
          aria-label="Open tool output preview"
        >
          <img
            src={src}
            alt="Tool output"
            loading="lazy"
            className="h-auto max-h-80 w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}
