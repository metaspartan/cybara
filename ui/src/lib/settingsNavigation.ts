import type { TranslationKey } from "../../../shared/i18n/catalog";

export type SettingsSectionId =
  | "general"
  | "accessibility"
  | "gateway"
  | "ai"
  | "agents"
  | "providers"
  | "router"
  | "channels"
  | "mobile"
  | "plugins"
  | "mcp"
  | "skills"
  | "tools"
  | "memory"
  | "voice"
  | "safety"
  | "wallet"
  | "logs"
  | "migration"
  | "updates"
  | "system";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  description: string;
}

export interface SettingsSectionGroup {
  labelKey: TranslationKey;
  sections: SettingsSectionDefinition[];
}

export const settingsSectionGroups: SettingsSectionGroup[] = [
  {
    labelKey: "settings.core",
    sections: [
      {
        id: "general",
        labelKey: "settings.general",
        description: "Appearance and product identity",
      },
      {
        id: "accessibility",
        labelKey: "settings.accessibility",
        description: "Readability and visual comfort",
      },
      {
        id: "gateway",
        labelKey: "settings.gateway",
        description: "Connection, auth, paths, and runtime",
      },
      {
        id: "ai",
        labelKey: "settings.ai",
        description: "Prompting, model defaults, and watchdogs",
      },
    ],
  },
  {
    labelKey: "settings.agentModels",
    sections: [
      { id: "agents", labelKey: "nav.agents", description: "Agent profiles and defaults" },
      { id: "providers", labelKey: "nav.providers", description: "Model provider connections" },
      { id: "router", labelKey: "nav.router", description: "Automatic agent routing" },
      { id: "channels", labelKey: "nav.channels", description: "Messaging channel connections" },
      { id: "mobile", labelKey: "nav.mobile", description: "Mobile pairing and devices" },
    ],
  },
  {
    labelKey: "settings.capabilities",
    sections: [
      { id: "plugins", labelKey: "nav.plugins", description: "Installed and discoverable plugins" },
      { id: "mcp", labelKey: "nav.mcp", description: "MCP server connections" },
      { id: "skills", labelKey: "nav.skills", description: "Agent skills and registries" },
      { id: "tools", labelKey: "nav.tools", description: "Tool catalog and permissions" },
      {
        id: "memory",
        labelKey: "nav.memory",
        description: "Memory provider, learning, and indexing",
      },
      {
        id: "voice",
        labelKey: "settings.voice",
        description: "Text-to-speech and dictation",
      },
      {
        id: "wallet",
        labelKey: "nav.wallet",
        description: "Wallet access and agent policy",
      },
    ],
  },
  {
    labelKey: "settings.security",
    sections: [
      {
        id: "safety",
        labelKey: "settings.safety",
        description: "Approvals, terminal, sandbox, and computer use",
      },
    ],
  },
  {
    labelKey: "nav.system",
    sections: [
      {
        id: "updates",
        labelKey: "settings.updates",
        description: "Version, releases, and build provenance",
      },
      {
        id: "migration",
        labelKey: "settings.migration",
        description: "Import legacy agent data",
      },
      {
        id: "system",
        labelKey: "nav.system",
        description: "Metrics, diagnostics, and health",
      },
      {
        id: "logs",
        labelKey: "nav.logs",
        description: "Gateway and application logs",
      },
    ],
  },
];

export const settingsSections = settingsSectionGroups.flatMap((group) => group.sections);

const settingsSectionAliases: Partial<Record<string, SettingsSectionId>> = {
  auth: "gateway",
  desktop: "safety",
  "ai-memory": "memory",
};

export function resolveSettingsSectionId(value: string | null): SettingsSectionId | null {
  if (!value) return null;
  if (settingsSections.some((section) => section.id === value)) return value as SettingsSectionId;
  return settingsSectionAliases[value] ?? null;
}
