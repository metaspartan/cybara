export type SettingsSectionId =
  | "general"
  | "gateway"
  | "ai"
  | "memory"
  | "voice"
  | "safety"
  | "wallet"
  | "migration"
  | "system";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  description: string;
}

export interface SettingsSectionGroup {
  label: string;
  sections: SettingsSectionDefinition[];
}

export const settingsSectionGroups: SettingsSectionGroup[] = [
  {
    label: "Core",
    sections: [
      {
        id: "general",
        label: "General",
        description: "Appearance and product identity",
      },
      {
        id: "gateway",
        label: "Gateway",
        description: "Connection, auth, paths, and runtime",
      },
      {
        id: "ai",
        label: "AI",
        description: "Prompting, model defaults, and watchdogs",
      },
    ],
  },
  {
    label: "Capabilities",
    sections: [
      {
        id: "memory",
        label: "Memory",
        description: "Memory provider, learning, and indexing",
      },
      {
        id: "voice",
        label: "Voice",
        description: "Text-to-speech and dictation",
      },
      {
        id: "wallet",
        label: "Wallet",
        description: "Wallet access and agent policy",
      },
    ],
  },
  {
    label: "Security",
    sections: [
      {
        id: "safety",
        label: "Safety",
        description: "Approvals, terminal, sandbox, and computer use",
      },
    ],
  },
  {
    label: "System",
    sections: [
      {
        id: "migration",
        label: "Migration",
        description: "Import from OpenClaw or Hermes",
      },
      {
        id: "system",
        label: "System",
        description: "Updates, metrics, diagnostics, and health",
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
