import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, GitCompare, X } from "lucide-react";
import type { Subagent } from "@/hooks/useApi";
import { formatRelativeTime } from "@/lib/utils";
import {
  formatWorkspaceLabel,
  type FileChangeSummary,
  type SessionPlanTimelineEntry,
  type SessionPlanView,
} from "./chatModel";
import {
  PlanSummaryCard,
  sessionPlanCurrentTask,
  sessionPlanProgressLabel,
} from "./PlanSummaryCard";

function EnvironmentSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 text-[12px] font-medium text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function EnvironmentRow({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-gray-500">{icon}</span>
      <span className="w-16 shrink-0 text-gray-300">{label}</span>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </div>
  );
}

export function ChatEnvironmentOverview({
  currentPlan,
  fileChanges,
  isOpen,
  onClose,
  planTimeline,
  sessionId,
  subagents,
  toolNames,
  workspaceDir,
}: {
  currentPlan: SessionPlanView | null;
  fileChanges: FileChangeSummary | null;
  isOpen: boolean;
  onClose: () => void;
  planTimeline: SessionPlanTimelineEntry[];
  sessionId: string | null;
  subagents: Subagent[];
  toolNames: string[];
  workspaceDir: string | null;
}) {
  if (!isOpen) return null;
  const previousPlans = [...planTimeline].reverse().slice(1, 6);

  const panel = (
    <div
      className="chat-environment-panel fixed right-3 top-[52px] z-[2147483000] max-h-[calc(100vh-68px)] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border p-3 text-sm shadow-[0_28px_90px_rgba(0,0,0,0.92)]"
      data-session-id={sessionId || "new-chat"}
      data-testid="chat-environment-overview"
      style={{
        WebkitBackdropFilter: "none",
        backdropFilter: "none",
        background: "var(--chat-environment-panel-bg)",
        backgroundColor: "var(--chat-environment-panel-bg)",
        borderColor: "var(--chat-environment-panel-border)",
        color: "var(--chat-environment-panel-text)",
        opacity: 1,
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-gray-200">Environment</div>
          <div className="text-[11px] text-gray-500">Current chat only</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-[#242733] hover:text-gray-200"
          title="Close environment overview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <EnvironmentRow icon={<GitCompare className="h-3.5 w-3.5" />} label="Changes">
            {fileChanges && fileChanges.files.length > 0 ? (
              <span>
                {fileChanges.files.length} files
                <span className="ml-2 text-green-300">+{fileChanges.totalAdded}</span>
                <span className="ml-1 text-red-300">-{fileChanges.totalRemoved}</span>
              </span>
            ) : (
              <span className="text-gray-500">No file diffs</span>
            )}
          </EnvironmentRow>
          <EnvironmentRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="Local">
            <span className="truncate font-mono text-[11px] text-gray-300">
              {workspaceDir ? formatWorkspaceLabel(workspaceDir, 34) : "No workspace"}
            </span>
          </EnvironmentRow>
        </div>

        <EnvironmentSection title="Plans">
          {currentPlan ? (
            <PlanSummaryCard plan={currentPlan} expandable title="Latest plan update" />
          ) : (
            <div className="rounded-lg border border-[#343843] bg-[#171a22] p-2 text-[12px] text-gray-500">
              No plan has been recorded for this chat.
            </div>
          )}
          {previousPlans.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-gray-600">Earlier updates in this chat</div>
              {previousPlans.map((plan) => (
                <div
                  key={`${plan.messageIndex}-${plan.toolIndex}`}
                  className="rounded-lg border border-[#2b303b] bg-[#11141b] px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-gray-500">
                      Update {plan.messageIndex + 1}.{plan.toolIndex + 1}
                    </span>
                    <span className="text-gray-400">{sessionPlanProgressLabel(plan)}</span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-gray-300">
                    {sessionPlanCurrentTask(plan)}
                  </p>
                  {plan.updatedAt && (
                    <p className="mt-0.5 text-[10px] text-gray-600">
                      {formatRelativeTime(plan.updatedAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </EnvironmentSection>

        <EnvironmentSection title="Subagents">
          {subagents.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5">
              {subagents.slice(0, 6).map((subagent) => (
                <div
                  key={subagent.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-[12px]"
                >
                  <span className="truncate text-gray-300">{subagent.label}</span>
                  <span className="shrink-0 text-[10px] capitalize text-gray-500">
                    {subagent.status}
                  </span>
                </div>
              ))}
              {subagents.length > 6 && (
                <div className="px-1 text-[11px] text-gray-600">
                  Show {subagents.length - 6} more in Subagents
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-gray-500">No active subagents</div>
          )}
        </EnvironmentSection>

        <EnvironmentSection title="Sources">
          {toolNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {toolNames.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-[#343843] bg-[#171a22] px-2 py-1 text-[11px] text-gray-400"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-gray-500">No tool sources yet</div>
          )}
        </EnvironmentSection>
      </div>
    </div>
  );

  if (typeof document === "undefined") return panel;
  return createPortal(panel, document.body);
}
