import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Subagent } from "@/hooks/useApi";
import {
  formatSandboxProviderLabel,
  getLatestInFlightStep,
  isGenericStatusLabel,
} from "./chatModel";
import {
  groupActivitiesForDisplay,
  mergeActivityLists,
  type LiveActivityItem,
} from "@/lib/chatActivities";

function ActivityRow({ activity }: { activity: LiveActivityItem }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-[12px] px-0.5",
        activity.toolName === "__thought" ? "text-gray-300" : "text-gray-400"
      )}
    >
      {activity.toolName === "__thought" ? (
        <Sparkles className="w-3 h-3 text-indigo-300 mt-0.5 flex-shrink-0" />
      ) : activity.phase === "start" ? (
        <Loader2 className="w-3 h-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
      ) : activity.phase === "result" ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <ActivityText text={activity.text} />
        {activity.toolName !== "__thought" && activity.sandboxProvider && (
          <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
            {formatSandboxProviderLabel(activity.sandboxProvider)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Codex-style activity list: consecutive completed reads/searches/lists
 * collapse into one summary row ("Read 3 files") that expands on click.
 * Failures and in-flight steps always render individually.
 */
export function GroupedActivityRows({ activities }: { activities: LiveActivityItem[] }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const entries = groupActivitiesForDisplay(activities);

  const toggleGroup = (id: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        if (entry.type === "single") {
          return <ActivityRow key={entry.activity.id} activity={entry.activity} />;
        }
        const expanded = expandedGroups.has(entry.id);
        return (
          <div key={entry.id}>
            <button
              type="button"
              onClick={() => toggleGroup(entry.id)}
              className="w-full flex items-center gap-2 text-[12px] px-0.5 text-left text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
              aria-expanded={expanded}
              title={expanded ? "Collapse" : "Show each call"}
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="min-w-0 truncate">{entry.label}</span>
              {expanded ? (
                <ChevronUp className="w-3 h-3 text-gray-600 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-gray-600 flex-shrink-0" />
              )}
            </button>
            {expanded && (
              <div className="ml-[5px] mt-1 space-y-1 border-l border-white/10 pl-2.5">
                {entry.items.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function SubagentCallItem({
  subagent,
}: {
  subagent: { id: string; task: string; status: string };
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    running: {
      color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    completed: {
      color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-emerald-400" />,
    },
    failed: {
      color: "text-red-400 border-red-500/30 bg-red-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-red-400" />,
    },
    killed: {
      color: "text-gray-400 border-gray-500/30 bg-gray-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-gray-400" />,
    },
  };

  const config = statusConfig[subagent.status as keyof typeof statusConfig] || statusConfig.running;

  return (
    <div className={`rounded-lg border ${config.color} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm"
      >
        {config.icon}
        <Zap className="w-3 h-3" />
        <span className="font-medium truncate">Subagent: {subagent.task.slice(0, 50)}...</span>
        <span className="flex-1" />
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/10">
          <div className="mt-2">
            <p className="text-[12px] text-gray-500 mb-1">Task:</p>
            <p className="text-sm text-gray-300">{subagent.task}</p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-[12px] text-gray-500">
              ID: <code className="text-gray-400">{subagent.id}</code>
            </p>
            <Badge
              variant={
                subagent.status === "completed"
                  ? "success"
                  : subagent.status === "failed"
                    ? "error"
                    : "default"
              }
              size="sm"
            >
              {subagent.status}
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveActivityTimeline({
  status,
  activities,
  currentStep,
}: {
  status: "thinking" | "generating" | "compacting" | "idle";
  activities: LiveActivityItem[];
  currentStep?: string | null;
}) {
  const visibleActivities = activities.filter((activity) => !isGenericStatusLabel(activity.text));
  const activeStartStep = getLatestInFlightStep(visibleActivities);
  const explicitCurrentStep =
    typeof currentStep === "string" && currentStep.trim().length > 0 ? currentStep.trim() : null;
  const normalizedCurrentStep =
    explicitCurrentStep && !isGenericStatusLabel(explicitCurrentStep) ? explicitCurrentStep : null;
  const displayCurrentStep = activeStartStep
    ? null
    : normalizedCurrentStep ||
      (status === "generating"
        ? "Generating response..."
        : status === "compacting"
          ? "Context automatically compacted"
          : status === "thinking"
            ? "Thinking..."
            : null);

  return (
    <div className="space-y-1">
      {visibleActivities.length > 0 && <GroupedActivityRows activities={visibleActivities} />}
      {displayCurrentStep ? (
        <div className="flex items-start gap-2 text-[12px] px-0.5 text-gray-300">
          <Loader2 className="w-3 h-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-wrap break-words">{displayCurrentStep}</span>
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="flex gap-1 px-1">
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ProcessActivityList({ activities }: { activities: LiveActivityItem[] }) {
  if (activities.length === 0) return null;

  const visibleActivities = activities.filter((activity) => !isGenericStatusLabel(activity.text));
  if (visibleActivities.length === 0) return null;

  return <GroupedActivityRows activities={visibleActivities} />;
}

export function ActivityStepCard({
  activity,
  isLast,
}: {
  activity: LiveActivityItem;
  isLast: boolean;
}) {
  const phaseStyles = {
    start: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    result: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  } as const;

  const phaseIcon =
    activity.phase === "start" ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
    ) : activity.phase === "result" ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
    ) : (
      <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
    );

  return (
    <div className="relative pl-6">
      {!isLast && (
        <div className="absolute left-[10px] top-5 h-[calc(100%-8px)] w-px bg-white/10" />
      )}
      <div className="absolute left-0 top-1.5 h-5 w-5 rounded-full border border-white/10 bg-[#090b13] flex items-center justify-center">
        {phaseIcon}
      </div>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-[12px] leading-5 backdrop-blur-sm",
          phaseStyles[activity.phase]
        )}
      >
        <div className="min-w-0 flex items-center gap-2">
          <ActivityText text={activity.text} />
          {activity.toolName !== "__thought" && activity.sandboxProvider && (
            <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
              {formatSandboxProviderLabel(activity.sandboxProvider)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActivityText({ text }: { text: string }) {
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
            <span key={`activity-text-${index}`} className="text-green-300">
              {part}
            </span>
          );
        }
        if (/^\s-\d+$/.test(part)) {
          return (
            <span key={`activity-text-${index}`} className="text-red-300">
              {part}
            </span>
          );
        }
        return <span key={`activity-text-${index}`}>{part}</span>;
      })}
    </span>
  );
}
