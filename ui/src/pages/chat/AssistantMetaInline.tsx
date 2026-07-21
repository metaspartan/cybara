import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { type JSX, useState } from "react";
import {
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
} from "@/lib/chatActivities";
import { useI18n } from "@/lib/i18n";
import { CompletedActivityTimeline } from "./ActivityTimeline";
import {
  collectMessageArtifacts,
  formatWorkedDuration,
  inferThoughtActivitiesFromContent,
  inferThoughtActivitiesFromThinking,
  parseTimestampMs,
  resolveWorkedDurationMs,
} from "./assistantMetaModel";
import {
  type ArtifactSummaryView,
  type ChatMessage,
  getToolCallsInTimelineOrder,
  resolveToolCallSandboxProvider,
  summarizeMessageFileChanges,
} from "./chatModel";
import { FileChangesCard } from "./FileChangesCard";

interface ArtifactSummaryCardProps {
  artifacts: ArtifactSummaryView[];
  onOpenArtifact?: (artifact: ArtifactSummaryView) => void;
}

function ArtifactSummaryCard({ artifacts, onOpenArtifact }: ArtifactSummaryCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full px-3 py-2 flex items-center gap-2 text-[12px] cursor-pointer hover:bg-white/5 transition-colors"
      >
        <FileText className="w-3 h-3 text-indigo-300" />
        <span className="text-gray-200 font-medium">
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} created/updated
        </span>
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {artifacts.map((artifact) => (
            <div
              key={`${artifact.sessionId}:${artifact.fileName}`}
              className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-gray-200">{artifact.fileName}</p>
                <p className="text-[10px] text-gray-500 truncate">{artifact.sessionId}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenArtifact?.(artifact)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface AssistantMetaInlineProps {
  message: ChatMessage;
  processActivities?: LiveActivityItem[];
  sessionId?: string | null;
  turnStartedAtMs?: number;
  onOpenArtifact?: (artifact: ArtifactSummaryView) => void;
  section?: "work" | "summary";
  workspaceDir?: string | null;
}

export function AssistantMetaInline({
  message,
  processActivities,
  sessionId,
  turnStartedAtMs,
  onOpenArtifact,
  section = "work",
  workspaceDir,
}: AssistantMetaInlineProps): JSX.Element | null {
  const { t } = useI18n();
  const isWorkSection = section === "work";
  const orderedToolCalls = getToolCallsInTimelineOrder(message.tool_calls);
  const fileChangeSummary = summarizeMessageFileChanges(orderedToolCalls);
  const artifactSummary = collectMessageArtifacts(orderedToolCalls, sessionId);
  const workedDurationMs = resolveWorkedDurationMs(processActivities, message.tool_calls, {
    assistantTimestamp: message.timestamp,
    turnStartedAtMs,
    workedDurationMs: message.worked_duration_ms,
  });
  const normalizedProcessActivities =
    processActivities && processActivities.length > 0
      ? finalizeCompletedActivities(processActivities)
      : [];
  const hasPersistedThoughtActivities = normalizedProcessActivities.some(
    (activity) => activity.toolName === "__thought"
  );
  const inferredThoughtActivities = hasPersistedThoughtActivities
    ? []
    : inferThoughtActivitiesFromContent(
        message.content,
        parseTimestampMs(message.timestamp) ?? turnStartedAtMs
      );
  const inferredThinkingActivities =
    !hasPersistedThoughtActivities && inferredThoughtActivities.length === 0
      ? inferThoughtActivitiesFromThinking(
          message.thinking,
          parseTimestampMs(message.timestamp) ?? turnStartedAtMs
        )
      : [];
  const workActivities = mergeActivityLists(
    normalizedProcessActivities,
    mergeActivityLists(inferredThoughtActivities, inferredThinkingActivities)
  );
  const sandboxProviderByToolCallId = new Map<string, string>();
  for (const toolCall of orderedToolCalls) {
    const toolCallId = typeof toolCall.id === "string" ? toolCall.id.trim().toLowerCase() : "";
    if (!toolCallId) continue;
    const sandboxProvider = resolveToolCallSandboxProvider(toolCall);
    if (sandboxProvider) sandboxProviderByToolCallId.set(toolCallId, sandboxProvider);
  }
  const workActivitiesWithSandbox = workActivities.map((activity) => {
    if (activity.sandboxProvider) return activity;
    const toolCallId =
      typeof activity.toolCallId === "string" ? activity.toolCallId.trim().toLowerCase() : "";
    const sandboxProvider = toolCallId ? sandboxProviderByToolCallId.get(toolCallId) : undefined;
    return sandboxProvider ? { ...activity, sandboxProvider } : activity;
  });
  const hasWorkSectionContent = workActivities.length > 0;
  const hasSummarySectionContent = Boolean(fileChangeSummary) || artifactSummary.length > 0;

  if ((isWorkSection && !hasWorkSectionContent) || (!isWorkSection && !hasSummarySectionContent)) {
    return null;
  }

  return (
    <div className={`space-y-2 ${isWorkSection ? "mb-3" : "mt-3"}`}>
      {isWorkSection && workActivitiesWithSandbox.length > 0 && (
        <CompletedActivityTimeline
          activities={workActivitiesWithSandbox}
          label={t("chat.workedFor", {
            duration:
              workedDurationMs !== undefined
                ? formatWorkedDuration(workedDurationMs)
                : "0h 00m 00s",
          })}
        />
      )}
      {!isWorkSection && fileChangeSummary && (
        <FileChangesCard summary={fileChangeSummary} workspaceDir={workspaceDir} />
      )}
      {!isWorkSection && artifactSummary.length > 0 && (
        <ArtifactSummaryCard artifacts={artifactSummary} onOpenArtifact={onOpenArtifact} />
      )}
    </div>
  );
}
