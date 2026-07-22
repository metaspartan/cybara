import React from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { normalizeActivityTextForPhase, type LiveActivityItem } from "@/lib/chatActivities";
import { cn } from "@/lib/utils";
import {
  isGenericIdeStatusLabel,
  formatIdeStatusEventText,
  formatIdeSandboxProviderLabel,
  getLatestIdeInFlightStep,
} from "./ideActivityHelpers";
import type { IdeProcessActivity } from "./ideTypes";
import { LiveStatusIndicator, LiveStatusOrb } from "../chat/LiveStatusIndicator";

export function IdeActivityText({ text }: { text: string }) {
  const shouldHighlightCounters = /^(Edited|Created|Updated|Deleted)\b/i.test(text);
  if (!shouldHighlightCounters) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  const parts = text.split(/(\s\+\d+\b|\s-\d+\b)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (/^\s\+\d+$/.test(part)) {
          return (
            <span key={`ide-activity-text:${index}`} className="text-emerald-300">
              {part}
            </span>
          );
        }
        if (/^\s-\d+$/.test(part)) {
          return (
            <span key={`ide-activity-text:${index}`} className="text-red-300">
              {part}
            </span>
          );
        }
        return <span key={`ide-activity-text:${index}`}>{part}</span>;
      })}
    </span>
  );
}

export function IdeProcessActivityList({ activities }: { activities: LiveActivityItem[] }) {
  if (activities.length === 0) return null;
  const visibleActivities = activities.filter(
    (activity) => !isGenericIdeStatusLabel(activity.text)
  );
  if (visibleActivities.length === 0) return null;

  return (
    <div className="space-y-1">
      {visibleActivities.map((activity) =>
        activity.toolName === "__thought" ? (
          <div
            key={activity.id}
            className="px-0.5 py-0.5 text-[12.5px] leading-relaxed text-gray-200"
          >
            <IdeActivityText text={activity.text} />
          </div>
        ) : (
          <div
            key={activity.id}
            className="flex items-start gap-1.5 text-[12px] px-0.5 text-gray-400"
          >
            {activity.phase === "start" ? (
              <LiveStatusOrb state="solving" size={20} className="opacity-80" />
            ) : activity.phase === "result" ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 flex-shrink-0" />
            ) : activity.phase === "blocked" ? (
              <AlertTriangle className="h-3 w-3 text-amber-300 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-rose-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <IdeActivityText text={activity.text} />
              {activity.sandboxProvider && (
                <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
                  {formatIdeSandboxProviderLabel(activity.sandboxProvider)}
                </span>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function IdeLiveActivityTimeline({
  status,
  activities,
  currentStep,
}: {
  status: "thinking" | "generating" | "idle";
  activities: LiveActivityItem[];
  currentStep?: string | null;
}) {
  const visibleActivities = activities.filter(
    (activity) => !isGenericIdeStatusLabel(activity.text)
  );
  const activeStartStep = getLatestIdeInFlightStep(visibleActivities);
  const explicitCurrentStep =
    typeof currentStep === "string" && currentStep.trim().length > 0 ? currentStep.trim() : null;
  const normalizedCurrentStep =
    explicitCurrentStep && !isGenericIdeStatusLabel(explicitCurrentStep)
      ? explicitCurrentStep
      : null;
  const displayCurrentStep = activeStartStep
    ? null
    : normalizedCurrentStep ||
      (status === "generating"
        ? "Generating response..."
        : status === "thinking"
          ? "Thinking..."
          : null);

  return (
    <div className="space-y-1">
      {visibleActivities.length > 0 && <IdeProcessActivityList activities={visibleActivities} />}
      {displayCurrentStep ? (
        <LiveStatusIndicator
          text={displayCurrentStep}
          className="px-0.5 text-[12px] text-gray-300"
        />
      ) : visibleActivities.length === 0 ? (
        <div className="flex gap-1 px-1">
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : null}
    </div>
  );
}
