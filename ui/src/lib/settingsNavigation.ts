import type { TranslationKey } from "../../../shared/i18n/catalog";

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
    labelKey: "settings.capabilities",
    sections: [
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
        id: "migration",
        labelKey: "settings.migration",
        description: "Import from OpenClaw or Hermes",
      },
      {
        id: "system",
        labelKey: "nav.system",
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
