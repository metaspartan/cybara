import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle,
  Clock,
  Cloud,
  Cpu,
  Database,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@/components/layout";
import { SystemMonitorPanel } from "@/components/settings/SystemMonitorPanel";
import { Badge } from "@/components/ui/Badge";
import { useHealth, useInfo } from "@/hooks/useApi";
import {
  getDashboardCheckStatus,
  type DashboardHealthStatus,
} from "@/pages/dashboard/dashboardStatus";

interface DashboardStat {
  name: string;
  value: number;
  icon: LucideIcon;
  href: string;
}

interface DashboardAction {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
}

const quickActions: DashboardAction[] = [
  {
    title: "Create an Agent",
    description: "Set up an agent with the model and capabilities you need",
    icon: Bot,
    href: "/agents",
  },
  {
    title: "Add a Provider",
    description: "Connect a hosted model, coding plan, or local runtime",
    icon: Cloud,
    href: "/providers",
  },
  {
    title: "Configure Channels",
    description: "Connect messaging channels for agents and automations",
    icon: MessageSquare,
    href: "/channels",
  },
];

const healthIcons: Record<string, LucideIcon> = {
  database: Database,
  agents: Bot,
  providers: Cloud,
  memory: Cpu,
};

function statusColor(status: DashboardHealthStatus): string {
  if (status === "healthy") return "var(--context-ring-ok)";
  if (status === "warning") return "var(--context-ring-warn)";
  return "var(--context-ring-danger)";
}

function statusStyle(status: DashboardHealthStatus): CSSProperties {
  const color = statusColor(status);
  return {
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
  };
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)]">
      <div className="border-b border-[var(--surface-border)] px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function StatLink({ stat }: { stat: DashboardStat }) {
  const Icon = stat.icon;
  return (
    <Link
      to={stat.href}
      className="group flex min-h-32 flex-col justify-between rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-primary))]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--text-muted)]">{stat.name}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--text-primary)]">
            {stat.value}
          </p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <span className="flex items-center gap-1 text-sm text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]">
        Manage
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function QuickStartPanel() {
  return (
    <Panel title="Quick Start" description="Common setup actions">
      <div className="divide-y divide-[var(--surface-border)]">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.title}
              to={action.href}
              className="group flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">{action.title}</h3>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{action.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--icon-muted)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--icon-hover)]" />
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function HealthBadge({ status }: { status: DashboardHealthStatus }) {
  return (
    <Badge variant={status === "healthy" ? "success" : status === "warning" ? "warning" : "error"}>
      {status === "healthy" ? (
        <CheckCircle className="mr-1 h-3 w-3" />
      ) : (
        <Activity className="mr-1 h-3 w-3" />
      )}
      {status}
    </Badge>
  );
}

function ServiceHealthPanel({ health }: { health: ReturnType<typeof useHealth>["data"] }) {
  const overallStatus: DashboardHealthStatus =
    health?.status === "healthy"
      ? "healthy"
      : health?.status === "warning" || health?.status === "degraded"
        ? "warning"
        : "error";
  const checks = health?.checks
    ? Object.entries(health.checks).filter(([key]) => key !== "memory" && key !== "system")
    : [];

  return (
    <Panel title="Service Health" description="Live gateway component status">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: statusColor(overallStatus) }}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Overall Status</p>
            <p className="text-xs text-[var(--text-muted)]">Gateway and configured services</p>
          </div>
        </div>
        <HealthBadge status={overallStatus} />
      </div>
      <div className="divide-y divide-[var(--surface-border)]">
        {checks.map(([key, value]) => {
          const check = getDashboardCheckStatus(value);
          const Icon = healthIcons[key] ?? Activity;
          return (
            <div
              key={key}
              className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={statusStyle(check.status)}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium capitalize text-[var(--text-primary)]">
                    {key}
                  </p>
                  {check.details ? (
                    <p className="text-xs text-[var(--text-muted)]">{check.details}</p>
                  ) : null}
                </div>
              </div>
              <HealthBadge status={check.status} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function Dashboard() {
  const { data: info } = useInfo();
  const { data: health } = useHealth();
  const stats: DashboardStat[] = [
    {
      name: "Agents",
      value: info?.stats.agents.total ?? 0,
      icon: Bot,
      href: "/agents",
    },
    {
      name: "Providers",
      value: info?.stats.providers.total ?? 0,
      icon: Cloud,
      href: "/providers",
    },
    {
      name: "Channels",
      value: info?.stats.channels.total ?? 0,
      icon: MessageSquare,
      href: "/channels",
    },
    {
      name: "Tasks",
      value: info?.stats.tasks.total ?? 0,
      icon: Clock,
      href: "/tasks",
    },
  ];

  return (
    <PageLayout title="Dashboard" subtitle="Overview of your agent platform">
      <div className="space-y-5">
        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Platform summary"
        >
          {stats.map((stat) => (
            <StatLink key={stat.name} stat={stat} />
          ))}
        </section>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(21rem,0.92fr)]">
          <QuickStartPanel />
          <ServiceHealthPanel health={health} />
        </div>
        <SystemMonitorPanel />
      </div>
    </PageLayout>
  );
}
