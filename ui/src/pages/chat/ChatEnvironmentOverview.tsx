import type { ReactNode } from "react";
import { FolderOpen, GitCompare, Globe2, ListChecks, X } from "lucide-react";
import type { Subagent } from "@/hooks/useApi";
import { formatRelativeTime } from "@/lib/utils";
import {
  formatWorkspaceLabel,
  type FileChangeSummary,
  type SessionPlanTimelineEntry,
  type SessionPlanView,
} from "./chatModel";

function sessionPlanProgressLabel(plan: SessionPlanTimelineEntry | SessionPlanView): string {
  if (plan.summary.total === 0) return "No tasks";
  return `${plan.summary.completed}/${plan.summary.total} complete`;
}

function sessionPlanCurrentTask(plan: SessionPlanTimelineEntry | SessionPlanView): string {
  return (
    plan.items.find((item) => item.status === "in_progress")?.content ||
    plan.items.find((item) => item.status === "pending")?.content ||
    plan.items[plan.items.length - 1]?.content ||
    "No active task"
  );
}

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
  browserOrigin,
  currentPlan,
  fileChanges,
  isOpen,
  onClose,
  planTimeline,
  subagents,
  toolNames,
  workspaceDir,
}: {
  browserOrigin: string;
  currentPlan: SessionPlanView | null;
  fileChanges: FileChangeSummary | null;
  isOpen: boolean;
  onClose: () => void;
  planTimeline: SessionPlanTimelineEntry[];
  subagents: Subagent[];
  toolNames: string[];
  workspaceDir: string | null;
}) {
  if (!isOpen) return null;
  const latestPlans = [...planTimeline].reverse().slice(0, 8);
  const currentProgress =
    currentPlan && currentPlan.summary.total > 0
      ? Math.round((currentPlan.summary.completed / currentPlan.summary.total) * 100)
      : 0;

  return (
    <div className="absolute right-3 top-[44px] z-50 max-h-[calc(100vh-58px)] w-[340px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-white/10 bg-[#17181d]/95 p-3 text-sm shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-gray-400">Environment</div>
          <div className="text-[11px] text-gray-600">Chat overview and current plan state</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200"
          title="Close environment overview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
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
          <EnvironmentRow icon={<Globe2 className="h-3.5 w-3.5" />} label="Browser">
            <span className="truncate font-mono text-[11px] text-gray-300">{browserOrigin}</span>
          </EnvironmentRow>
        </div>

        <EnvironmentSection title="Plans">
          {currentPlan ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate text-[12px] font-medium text-gray-200">
                    Latest plan update
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">
                  {sessionPlanProgressLabel(currentPlan)}
                </span>
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gray-400/70"
                  style={{ width: `${currentProgress}%` }}
                />
              </div>
              <p className="line-clamp-2 text-[12px] leading-5 text-gray-400">
                {sessionPlanCurrentTask(currentPlan)}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[12px] text-gray-500">
              No plan has been recorded for this chat.
            </div>
          )}
          {latestPlans.length > 0 && (
            <div className="space-y-1.5">
              {latestPlans.map((plan) => (
                <div
                  key={`${plan.messageIndex}-${plan.toolIndex}`}
                  className="rounded-lg border border-white/10 bg-black/15 px-2.5 py-2"
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
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-gray-400"
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
}
