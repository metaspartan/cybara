import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Subagent } from "@/hooks/useApi";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import { isProviderRecoveryStatusLabel } from "../../../../shared/chat-status";

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

export function SubagentTimeline({ subagent }: { subagent: Subagent }): ReactElement {
  const activities = useMemo(
    () =>
      [...(subagent.activities || [])]
        .filter((activity) => !isProviderRecoveryStatusLabel(activity.text))
        .sort((a, b) => a.timestamp - b.timestamp),
    [subagent.activities]
  );
  const toolCalls = useMemo(
    () =>
      [...(subagent.toolCalls || [])].sort(
        (a, b) =>
          (a.timeline_index ?? Number.MAX_SAFE_INTEGER) -
          (b.timeline_index ?? Number.MAX_SAFE_INTEGER)
      ),
    [subagent.toolCalls]
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-5">
      {activities.length > 0 ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Activity</h4>
          <div className="space-y-2 border-l border-white/10 pl-3">
            {activities.map((activity) => (
              <div key={activity.id} className="chat-activity-text flex gap-2 text-gray-400">
                <span
                  className={
                    activity.phase === "error" || activity.phase === "blocked"
                      ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400"
                      : activity.phase === "start"
                        ? "mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[rgb(var(--accent-primary))]"
                        : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500"
                  }
                />
                <div className="min-w-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {preprocessChatMarkdown(activity.text)}
                  </ReactMarkdown>
                  {activity.toolName && activity.toolName !== "__thought" ? (
                    <span className="chat-meta-text mt-0.5 block font-mono text-gray-600">
                      {activity.toolName} · {activity.phase}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {subagent.thinking && activities.every((activity) => activity.toolName !== "__thought") ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Thinking</h4>
          <div className="chat-thought-text rounded-md bg-white/[0.025] p-3 text-gray-400">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preprocessChatMarkdown(subagent.thinking)}
            </ReactMarkdown>
          </div>
        </section>
      ) : null}

      {toolCalls.length > 0 ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Tool calls</h4>
          <div className="space-y-1.5">
            {toolCalls.map((toolCall, index) => {
              const key = toolCall.id || `${toolCall.name}-${index}`;
              const expanded = expandedTools.has(key);
              return (
                <div key={key} className="overflow-hidden rounded-md bg-white/[0.025]">
                  <button
                    type="button"
                    className="chat-activity-text flex w-full items-center gap-2 px-3 py-2 text-left text-gray-300 hover:bg-white/[0.04]"
                    onClick={() =>
                      setExpandedTools((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono">{toolCall.name}</span>
                    <span
                      className={
                        toolCall.status === "failed"
                          ? "chat-meta-text capitalize text-red-400"
                          : toolCall.status === "executing" || toolCall.status === "pending"
                            ? "chat-meta-text capitalize text-[rgb(var(--accent-primary))]"
                            : "chat-meta-text capitalize text-gray-600"
                      }
                    >
                      {toolCall.status || "completed"}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="grid gap-2 border-t border-white/10 p-2.5">
                      {toolCall.args && Object.keys(toolCall.args).length > 0 ? (
                        <div>
                          <div className="chat-meta-text mb-1 uppercase text-gray-600">
                            Arguments
                          </div>
                          <pre className="chat-code-text max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 text-gray-400">
                            {formatJson(toolCall.args)}
                          </pre>
                        </div>
                      ) : null}
                      {toolCall.result !== null && toolCall.result !== undefined ? (
                        <div>
                          <div className="chat-meta-text mb-1 uppercase text-gray-600">Output</div>
                          <pre className="chat-code-text max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 text-gray-300">
                            {formatJson(toolCall.result)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
