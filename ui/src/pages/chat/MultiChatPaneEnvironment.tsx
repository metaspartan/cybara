import type { LoadedChatSession } from "@/hooks/useChat";
import type { AgentSummary } from "@/types";
import {
  Activity,
  Brain,
  Database,
  FolderOpen,
  Gauge,
  MessageSquare,
  Replace,
  Route,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspaceLSPStatus } from "@/hooks/useApi";

function compactNumber(value?: number): string {
  if (!value) return "0";
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function formatMilliseconds(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function EnvironmentValue({
  children,
  multiline = false,
  title,
}: {
  children: ReactNode;
  multiline?: boolean;
  title?: string;
}) {
  return (
    <span
      className={
        multiline
          ? "min-w-0 break-words text-right text-[10px] leading-4 text-[var(--text-secondary)]"
          : "min-w-0 truncate text-right text-[11px] text-[var(--text-secondary)]"
      }
      title={title}
    >
      {children}
    </span>
  );
}

function EnvironmentRow({
  icon,
  label,
  children,
  multiline = false,
  title,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  multiline?: boolean;
  title?: string;
}) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-2 py-1.5">
      <span className="text-[var(--icon-muted)]">{icon}</span>
      <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
      <EnvironmentValue multiline={multiline} title={title}>
        {children}
      </EnvironmentValue>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded-md bg-[var(--surface-raised)] px-2 py-1.5">
      <span className="theme-text-muted block truncate text-[9px] uppercase">{label}</span>
      <span className="theme-text-primary mt-0.5 block truncate text-[11px] font-semibold tabular-nums">
        {value}
      </span>
    </span>
  );
}

export function MultiChatPaneEnvironment({
  agent,
  detail,
  draft,
  messageCount,
  statusLabel,
  onReplace,
}: {
  agent?: AgentSummary;
  detail?: LoadedChatSession;
  draft: boolean;
  messageCount: number;
  statusLabel: string;
  onReplace: () => void;
}) {
  const contextUsage = detail?.contextUsage;
  const tokenUsage = detail?.tokenUsage;
  const routeLabel = detail?.use_model_router
    ? "Model Router"
    : agent?.name || detail?.provider_name || detail?.provider || "Gateway default";
  const modelLabel = agent?.model || detail?.model || "Automatic";
  const providerLabel = detail?.provider_name || detail?.provider || agent?.provider || "Automatic";
  const workspace = detail?.workspace_dir || "No workspace";
  const workspaceDir = detail?.workspace_dir?.trim() || null;
  const workspaceLsp = useWorkspaceLSPStatus(workspaceDir);
  const contextPercent = contextUsage ? Math.min(100, Math.max(0, contextUsage.usedPercent)) : 0;

  return (
    <aside
      className="absolute left-2 right-2 top-[52px] z-50 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3 sm:left-auto sm:w-80"
      data-testid="multi-chat-environment"
    >
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--surface-border)] pb-2">
        <span>
          <span className="theme-text-primary block text-xs font-semibold">Environment</span>
          <span className="theme-text-muted block text-[10px]">
            {draft ? "New chat" : statusLabel}
          </span>
        </span>
        <button
          type="button"
          onClick={onReplace}
          className="theme-muted-icon-button inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px]"
        >
          <Replace className="h-3 w-3" />
          Replace
        </button>
      </div>
      <div className="divide-y divide-[var(--surface-border)]">
        <EnvironmentRow icon={<Route className="h-3.5 w-3.5" />} label="Agent">
          {routeLabel}
        </EnvironmentRow>
        <EnvironmentRow icon={<Brain className="h-3.5 w-3.5" />} label="Model">
          {modelLabel}
        </EnvironmentRow>
        <EnvironmentRow icon={<Database className="h-3.5 w-3.5" />} label="Provider">
          {providerLabel}
        </EnvironmentRow>
        <EnvironmentRow
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label="Workspace"
          multiline
          title={workspace}
        >
          {workspace}
        </EnvironmentRow>
        {workspaceDir ? (
          <EnvironmentRow
            icon={<Zap className="h-3.5 w-3.5" />}
            label="LSP"
            title={workspaceLsp.data?.active.map((server) => server.name).join(", ")}
          >
            {workspaceLsp.isLoading
              ? "Checking..."
              : workspaceLsp.data?.active.length
                ? workspaceLsp.data.active.map((server) => server.name).join(", ")
                : "No active servers"}
          </EnvironmentRow>
        ) : null}
        <EnvironmentRow icon={<Activity className="h-3.5 w-3.5" />} label="Status">
          {draft ? "Draft" : statusLabel}
        </EnvironmentRow>
        <EnvironmentRow icon={<MessageSquare className="h-3.5 w-3.5" />} label="Messages">
          {messageCount}
        </EnvironmentRow>
        <EnvironmentRow icon={<Gauge className="h-3.5 w-3.5" />} label="Context">
          {contextUsage
            ? `${compactNumber(contextUsage.usedTokens)} / ${compactNumber(contextUsage.limitTokens)}`
            : "Not available"}
        </EnvironmentRow>
        <EnvironmentRow icon={<Gauge className="h-3.5 w-3.5" />} label="Tokens">
          {tokenUsage ? compactNumber(tokenUsage.totalTokens) : "Not available"}
        </EnvironmentRow>
      </div>
      {contextUsage ? (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-raised)]">
            <div
              className="h-full rounded-full bg-[rgb(var(--accent-primary))]"
              style={{ width: `${Math.max(2, contextPercent)}%` }}
            />
          </div>
          <div className="theme-text-muted mt-1 flex justify-between text-[9px] tabular-nums">
            <span>{Math.round(contextPercent)}% context used</span>
            <span>{compactNumber(contextUsage.remainingTokens)} remaining</span>
          </div>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <UsageStat label="Input" value={tokenUsage ? compactNumber(tokenUsage.inputTokens) : "—"} />
        <UsageStat
          label="Output"
          value={tokenUsage ? compactNumber(tokenUsage.outputTokens) : "—"}
        />
        <UsageStat
          label="Cache read"
          value={tokenUsage ? compactNumber(tokenUsage.cachedInputTokens) : "—"}
        />
        <UsageStat
          label="Cache write"
          value={tokenUsage ? compactNumber(tokenUsage.cacheWriteTokens) : "—"}
        />
        <UsageStat
          label="Cache hit"
          value={
            tokenUsage?.cacheHitRate === null || tokenUsage?.cacheHitRate === undefined
              ? "—"
              : `${tokenUsage.cacheHitRate}%`
          }
        />
        <UsageStat label="Calls" value={tokenUsage ? compactNumber(tokenUsage.callCount) : "—"} />
        <UsageStat
          label="Speed"
          value={
            tokenUsage?.tokensPerSecond === null || tokenUsage?.tokensPerSecond === undefined
              ? "—"
              : `${tokenUsage.tokensPerSecond.toFixed(1)}/s`
          }
        />
        <UsageStat label="TTFT" value={formatMilliseconds(tokenUsage?.firstTokenMs)} />
        <UsageStat label="Duration" value={formatMilliseconds(tokenUsage?.durationMs)} />
      </div>
    </aside>
  );
}
