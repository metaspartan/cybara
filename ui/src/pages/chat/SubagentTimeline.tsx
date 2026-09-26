import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import type { Subagent } from "@/hooks/useApi";
import { imageAltFromPath, imageSourceFromPath, imageViewedSource } from "@/lib/chatActivities";
import { isVisibleActivityText } from "../../../../shared/chat-status";
import type { ChatLinkOpenOptions } from "./chatLinkRouting";
import { ImageViewedThumbnail } from "./ActivityTimeline";
import { MessageContent } from "./MessageContent";

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "output", "stdout"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key];
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface TimelineToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result: unknown;
  status?: "pending" | "executing" | "completed" | "failed";
}

interface TimelineEntry {
  key: string;
  kind: "thought" | "tool";
  text: string;
  phase: "start" | "result" | "error" | "blocked";
  timestamp: number;
  toolCall?: TimelineToolCall;
  imageSource?: string;
  imageAlt?: string;
}

function statusTone(status: TimelineToolCall["status"], phase: TimelineEntry["phase"]): string {
  if (status === "failed" || phase === "error" || phase === "blocked")
    return "chat-meta-text capitalize text-red-400";
  if (status === "executing" || status === "pending" || phase === "start")
    return "chat-meta-text capitalize text-[rgb(var(--accent-primary))]";
  return "chat-meta-text capitalize text-gray-600";
}

function toolStatus(entry: TimelineEntry): string {
  return entry.toolCall?.status || (entry.phase === "start" ? "executing" : "completed");
}

export function SubagentTimeline({
  onOpenLink,
  subagent,
}: {
  onOpenLink: (href: string, options: ChatLinkOpenOptions) => boolean;
  subagent: Subagent;
}): ReactElement {
  const storedToolCalls = useMemo(
    () =>
      [...(subagent.toolCalls || [])].sort(
        (a, b) =>
          (a.timeline_index ?? Number.MAX_SAFE_INTEGER) -
          (b.timeline_index ?? Number.MAX_SAFE_INTEGER)
      ),
    [subagent.toolCalls]
  );

  const entries = useMemo<TimelineEntry[]>(() => {
    const activities = [...(subagent.activities || [])]
      .filter((activity) => isVisibleActivityText(activity.text))
      .sort((a, b) => a.timestamp - b.timestamp);
    const callsById = new Map<string, TimelineToolCall>();
    const callsByName = new Map<string, TimelineToolCall[]>();
    for (const toolCall of storedToolCalls) {
      if (toolCall.id) callsById.set(toolCall.id, toolCall);
      const name = toolCall.name.trim().toLowerCase();
      if (!name) continue;
      const named = callsByName.get(name) || [];
      named.push(toolCall);
      callsByName.set(name, named);
    }

    const matched = new Set<TimelineToolCall>();
    const entries: TimelineEntry[] = activities.map((activity, index) => {
      if (activity.toolName === "__thought") {
        return {
          key: activity.id || `thought-${index}`,
          kind: "thought",
          text: activity.text,
          phase: activity.phase,
          timestamp: activity.timestamp,
        };
      }
      let toolCall = activity.toolCallId ? callsById.get(activity.toolCallId) : undefined;
      if (!toolCall && activity.toolName) {
        const candidates = callsByName.get(activity.toolName.trim().toLowerCase()) || [];
        toolCall = candidates.find((candidate) => !matched.has(candidate)) ?? candidates[0];
      }
      if (toolCall) matched.add(toolCall);
      const imagePath = activity.imagePath?.trim();
      const imageSource =
        (imagePath ? imageSourceFromPath(imagePath) : undefined) ??
        (toolCall ? imageViewedSource(toolCall) : undefined);
      const imageAlt =
        (imagePath ? imageAltFromPath(imagePath) : undefined) ??
        (imagePath ? imagePath.split("/").pop() : undefined);
      return {
        key: activity.id || `tool-${index}`,
        kind: "tool",
        text: activity.text,
        phase: activity.phase,
        timestamp: activity.timestamp,
        toolCall,
        imageSource,
        imageAlt,
      };
    });

    for (const toolCall of storedToolCalls) {
      if (matched.has(toolCall)) continue;
      const imageSource = imageViewedSource(toolCall);
      if (!imageSource) continue;
      entries.push({
        key: toolCall.id || `tool-orphan-${entries.length}`,
        kind: "tool",
        text: toolCall.name,
        phase: toolCall.status === "failed" ? "error" : "result",
        timestamp: Number.MAX_SAFE_INTEGER,
        toolCall,
        imageSource,
        imageAlt: imageAltFromPath(
          typeof toolCall.args?.path === "string" ? toolCall.args.path : undefined
        ),
      });
    }
    return entries;
  }, [subagent.activities, storedToolCalls]);

  const hasThoughtEntries = entries.some((entry) => entry.kind === "thought");
  const [toggledRows, setToggledRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) => {
    setToggledRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const storedToolCallCount = subagent.toolCalls?.length || 0;
  const totalToolCallCount = Math.max(subagent.toolCallCount || 0, storedToolCallCount);

  return (
    <div className="space-y-5">
      {entries.length > 0 ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Timeline</h4>
          <div className="space-y-2 border-l border-white/10 pl-3">
            {entries.map((entry) => {
              if (entry.kind === "thought") {
                return (
                  <div key={entry.key} className="chat-thought-text flex gap-2 text-gray-500">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-600" />
                    <div className="min-w-0">
                      <MessageContent content={entry.text} onOpenLink={onOpenLink} />
                    </div>
                  </div>
                );
              }
              const defaultExpanded = Boolean(entry.imageSource);
              const expanded = defaultExpanded !== toggledRows.has(entry.key);
              const hasDetail = Boolean(
                entry.toolCall &&
                  ((entry.toolCall.args && Object.keys(entry.toolCall.args).length > 0) ||
                    (entry.toolCall.result !== null && entry.toolCall.result !== undefined))
              );
              const expandable = Boolean(hasDetail || entry.imageSource);
              return (
                <div key={entry.key} className="min-w-0">
                  <div className="chat-activity-text flex gap-2 text-gray-400">
                    <span
                      className={
                        entry.phase === "error" || entry.phase === "blocked"
                          ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400"
                          : entry.phase === "start"
                            ? "mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[rgb(var(--accent-primary))]"
                            : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500"
                      }
                    />
                    <div className="min-w-0 flex-1">
                      {expandable ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="flex w-full items-center gap-1.5 text-left hover:text-gray-200"
                          onClick={() => toggleRow(entry.key)}
                        >
                          {expanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1">
                            <MessageContent content={entry.text} onOpenLink={onOpenLink} />
                          </span>
                        </button>
                      ) : (
                        <MessageContent content={entry.text} onOpenLink={onOpenLink} />
                      )}
                      {entry.toolCall ? (
                        <span
                          className={`chat-meta-text mt-0.5 block ${statusTone(entry.toolCall.status, entry.phase)}`}
                        >
                          {entry.toolCall.name} · {toolStatus(entry)}
                        </span>
                      ) : (
                        <span className="chat-meta-text mt-0.5 block font-mono text-gray-600">
                          {entry.phase}
                        </span>
                      )}
                    </div>
                  </div>
                  {expanded && entry.imageSource ? (
                    <div className="mt-1.5 pl-5">
                      <ImageViewedThumbnail
                        source={entry.imageSource}
                        alt={entry.imageAlt || "Viewed image"}
                      />
                    </div>
                  ) : null}
                  {expanded && !entry.imageSource && hasDetail && entry.toolCall ? (
                    <div className="mt-1.5 grid gap-2 rounded-md bg-white/[0.025] p-2.5">
                      {entry.toolCall.args && Object.keys(entry.toolCall.args).length > 0 ? (
                        <div>
                          <div className="chat-meta-text mb-1 uppercase text-gray-600">
                            Arguments
                          </div>
                          <pre className="chat-code-text max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 text-gray-400">
                            {formatJson(entry.toolCall.args)}
                          </pre>
                        </div>
                      ) : null}
                      {entry.toolCall.result !== null && entry.toolCall.result !== undefined ? (
                        <div>
                          <div className="chat-meta-text mb-1 uppercase text-gray-600">Output</div>
                          <pre className="chat-code-text max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 text-gray-300">
                            {formatJson(entry.toolCall.result)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {totalToolCallCount > storedToolCallCount ? (
            <p className="chat-meta-text mt-2 text-gray-600">
              Showing the latest {storedToolCallCount} of {totalToolCallCount} tool calls
            </p>
          ) : null}
        </section>
      ) : null}

      {subagent.thinking && !hasThoughtEntries ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Thinking</h4>
          <div className="chat-thought-text rounded-md bg-white/[0.025] p-3 text-gray-400">
            <MessageContent content={subagent.thinking} onOpenLink={onOpenLink} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
