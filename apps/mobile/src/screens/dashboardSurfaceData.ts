import {
  Bot,
  Brain,
  CalendarCheck,
  Cpu,
  Database,
  Link2,
  ListTodo,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import type {
  ActivitySummary,
  FeatureEndpointKey,
  FeatureSummary,
  RemoteItemSummary,
} from "../lib/api";
import {
  formatMobileValue,
  formatUptime,
  lastUpdatedLabel,
  type FeatureCounts,
  type MobileSurfaceKey,
  type MobileTabKey,
} from "../lib/dashboard";
import { formatMetricBytes, formatStorageBytes } from "../lib/metrics";
import {
  displayFields,
  endpointStatusLabel,
  monitorPercentLabel,
  monitorPlatformLabel,
  surfaceCount,
} from "./dashboardHelpers";
import type { IconGlyph } from "./dashboardPrimitives";

export interface ModuleCard {
  key: string;
  label: string;
  detail: string;
  value: string;
  Icon: IconGlyph;
  tab: MobileTabKey;
  surface?: MobileSurfaceKey;
}

export type DetailRoute =
  | { kind: "session"; id: string }
  | { kind: "newChat" }
  | { kind: "newTask" }
  | { kind: "systemPrompt" }
  | { kind: "modelRouter" }
  | { kind: "speech" }
  | { kind: "memory" }
  | { kind: "migration" }
  | { kind: "journey" }
  | { kind: "surface"; surface: MobileSurfaceKey }
  | {
      kind: "item";
      surface: MobileSurfaceKey;
      item: RemoteItemSummary | ActivitySummary;
    };

export const surfaceMeta: Record<
  MobileSurfaceKey,
  {
    title: string;
    Icon: IconGlyph;
    tone: string;
    endpoint?: FeatureEndpointKey;
  }
> = {
  agents: {
    title: "Agents",
    Icon: Bot,
    get tone() {
      return colors.cyan;
    },
    endpoint: "agents",
  },
  providers: {
    title: "Providers",
    Icon: Database,
    get tone() {
      return colors.blueText;
    },
    endpoint: "providers",
  },
  skills: {
    title: "Skills",
    Icon: Sparkles,
    get tone() {
      return colors.amber;
    },
    endpoint: "skills",
  },
  tools: {
    title: "Tools",
    Icon: Wrench,
    get tone() {
      return colors.green;
    },
    endpoint: "tools",
  },
  approvals: {
    title: "Approvals",
    Icon: ShieldCheck,
    get tone() {
      return colors.amber;
    },
    endpoint: "approvals",
  },
  wallet: {
    title: "Wallet Policy",
    Icon: ShieldCheck,
    get tone() {
      return colors.green;
    },
    endpoint: "walletPolicy",
  },
  channels: {
    title: "Channels",
    Icon: Link2,
    get tone() {
      return colors.cyan;
    },
    endpoint: "channels",
  },
  tasks: {
    title: "Tasks",
    Icon: CalendarCheck,
    get tone() {
      return colors.blueText;
    },
    endpoint: "tasks",
  },
  memory: {
    title: "Memory",
    Icon: Brain,
    get tone() {
      return colors.green;
    },
    endpoint: "memory",
  },
  logs: {
    title: "Logs",
    Icon: ListTodo,
    get tone() {
      return colors.textMuted;
    },
    endpoint: "logs",
  },
  monitor: {
    title: "System Monitor",
    Icon: Cpu,
    get tone() {
      return colors.blueText;
    },
    endpoint: "systemMonitor",
  },
};

export function mergeActivityLogs(
  existing: ActivitySummary[],
  incoming: ActivitySummary[]
): ActivitySummary[] {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });
}

function itemFromRecord(
  id: string,
  title: string,
  detail: string,
  fields: Record<string, unknown>
): RemoteItemSummary {
  return {
    id,
    title,
    detail,
    fields: displayFields(fields),
  };
}

export function surfaceRows(
  surface: MobileSurfaceKey,
  summary: FeatureSummary | null
): Array<RemoteItemSummary | ActivitySummary> {
  if (!summary) return [];
  switch (surface) {
    case "agents":
      return summary.agents.reduce<RemoteItemSummary[]>((rows, agent) => {
        if (agent.is_bot) return rows;
        rows.push(
          itemFromRecord(
            agent.id,
            agent.name,
            [agent.status, agent.model, agent.type].filter(Boolean).join(" - ") || "Configured",
            agent as unknown as Record<string, unknown>
          )
        );
        return rows;
      }, []);
    case "providers":
      return summary.providers.map((provider) =>
        itemFromRecord(
          provider.id,
          provider.name,
          `${provider.provider}${provider.is_default ? " - default" : ""}`,
          provider as unknown as Record<string, unknown>
        )
      );
    case "skills":
      return summary.skills;
    case "tools":
      return summary.tools;
    case "approvals":
      return summary.approvals;
    case "channels":
      return summary.channels;
    case "tasks":
      return summary.tasks;
    case "memory":
      return summary.memory;
    case "logs":
      return summary.logs;
    case "wallet":
      return [
        itemFromRecord("wallet-policy", "Agent policy", formatMobileValue(summary.walletPolicy), {
          policy: summary.walletPolicy,
        }),
        itemFromRecord("wallet-status", "Wallet status", formatMobileValue(summary.walletStatus), {
          status: summary.walletStatus,
        }),
      ];
    case "monitor": {
      const monitor = summary.systemMonitor;
      if (!monitor) return [];
      return [
        itemFromRecord(
          "cpu",
          "CPU",
          `${monitorPercentLabel(monitor.cpu.usagePct)} - ${monitor.cpu.cores} cores`,
          {
            usagePct: monitor.cpu.usagePct,
            loadPct: monitor.cpu.loadPct,
            cores: monitor.cpu.cores,
            model: monitor.cpu.model,
            loadAverage: monitor.cpu.loadAverage.join(", "),
          }
        ),
        itemFromRecord(
          "memory",
          "Memory",
          `${monitorPercentLabel(monitor.memory.usedPct)} - ${formatMetricBytes(monitor.memory.usedBytes)} used`,
          monitor.memory
        ),
        ...(monitor.memory.swap
          ? [
              itemFromRecord(
                "swap",
                "Swap",
                `${monitorPercentLabel(monitor.memory.swap.usedPct)} - ${formatMetricBytes(monitor.memory.swap.usedBytes)} used`,
                monitor.memory.swap
              ),
            ]
          : []),
        itemFromRecord(
          "process",
          "Cybara process",
          `${formatMetricBytes(monitor.process.memory.rssBytes)} RSS - ${monitorPercentLabel(monitor.process.cpuUsagePct)} CPU`,
          {
            pid: monitor.process.pid,
            uptime: formatUptime(monitor.process.uptimeSeconds),
            cpuUsagePct: monitor.process.cpuUsagePct,
            ...monitor.process.memory,
          }
        ),
        ...(monitor.disk
          ? [
              itemFromRecord(
                "disk",
                "Disk",
                `${monitorPercentLabel(monitor.disk.usedPct)} - ${formatStorageBytes(monitor.disk.freeBytes)} free`,
                monitor.disk
              ),
            ]
          : []),
        itemFromRecord("runtime", "Runtime", monitorPlatformLabel(monitor), {
          platform: monitor.platform.type,
          architecture: monitor.platform.arch,
          release: monitor.platform.release,
          timestamp: monitor.timestamp,
          sampleIntervalMs: monitor.sampleIntervalMs,
        }),
      ];
    }
  }
}

export function surfaceMenuDetail(
  surface: MobileSurfaceKey,
  summary: FeatureSummary | null,
  counts: FeatureCounts,
  rowCount: number
): string {
  if (!summary) return "Loading";
  const endpoint = surfaceMeta[surface].endpoint;
  if (endpoint) {
    const state = summary.availability[endpoint];
    if (!state.ok) return endpointStatusLabel(state);
  }
  switch (surface) {
    case "agents":
      return surfaceCount(summary, "agents", counts.agents, "configured", "None configured");
    case "providers":
      return surfaceCount(summary, "providers", counts.providers, "enabled", "None enabled");
    case "skills":
      return surfaceCount(summary, "skills", counts.skills, "available", "No skills");
    case "tools":
      return surfaceCount(summary, "tools", counts.tools, "registered", "No tools");
    case "approvals":
      return counts.approvals > 0 ? `${counts.approvals} pending` : "No pending approvals";
    case "channels":
      return surfaceCount(summary, "channels", counts.channels, "configured", "None configured");
    case "tasks":
      return surfaceCount(summary, "tasks", counts.tasks, "scheduled", "No tasks");
    case "memory":
      return surfaceCount(summary, "memory", counts.memory, "files", "No memory files");
    case "logs":
      return surfaceCount(summary, "logs", counts.logs, "events", "No recent events");
    case "wallet":
      return summary.walletPolicy || summary.walletStatus ? "Policy and status" : "Unavailable";
    case "monitor":
      return summary.systemMonitor
        ? `CPU ${monitorPercentLabel(summary.systemMonitor.cpu.usagePct)} - RAM ${monitorPercentLabel(summary.systemMonitor.memory.usedPct)}`
        : rowCount > 0
          ? `${rowCount} readings`
          : "Telemetry";
  }
}

export function routeHeader(
  route: DetailRoute | null,
  fallback: { title: string; detail: string },
  summary: FeatureSummary | null
): { title: string; detail: string } {
  if (!route) return fallback;
  if (route.kind === "session") {
    const session = summary?.sessions.find((candidate) => candidate.id === route.id);
    return {
      title: session?.title || "Chat",
      detail: session
        ? `${session.message_count ?? 0} messages - ${lastUpdatedLabel(session)}`
        : "Chat details",
    };
  }
  if (route.kind === "newChat") {
    return { title: "New chat", detail: "Start a gateway-backed session" };
  }
  if (route.kind === "newTask") {
    return {
      title: "New task",
      detail: "Schedule an agent to run automatically",
    };
  }
  if (route.kind === "systemPrompt") {
    return {
      title: "System Prompt",
      detail: "Assistant identity and behavior",
    };
  }
  if (route.kind === "modelRouter") {
    return { title: "Model Router", detail: "Provider routing and fallback" };
  }
  if (route.kind === "speech") {
    return { title: "Voice & Speech", detail: "Text-to-speech and dictation" };
  }
  if (route.kind === "memory") {
    return {
      title: "Memory",
      detail: "Memory provider, learning, and indexing",
    };
  }
  if (route.kind === "migration") {
    return { title: "Migration", detail: "Import legacy agent data" };
  }
  if (route.kind === "journey") {
    return {
      title: "Journey",
      detail: "Skills and memories learned over time",
    };
  }
  if (route.kind === "surface") {
    const meta = surfaceMeta[route.surface];
    return { title: meta.title, detail: "Live gateway data" };
  }
  const meta = surfaceMeta[route.surface];
  return { title: meta.title, detail: route.item.title };
}
