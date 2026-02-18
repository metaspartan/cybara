import { tables } from "./database";

interface PlatformConfig {
  name: string;
  host: string;
  port: number;
  session_secret?: string;
  dangerous_tool_policy?: DangerousToolPolicyConfig;
  [key: string]: unknown;
}

export type DangerousToolPolicyMode = "audit" | "block";

export interface DangerousToolPolicyConfig {
  enabled: boolean;
  mode: DangerousToolPolicyMode;
}

export const DEFAULT_DANGEROUS_TOOL_POLICY: DangerousToolPolicyConfig = {
  enabled: false,
  mode: "audit",
};

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeDangerousToolPolicy(value: unknown): DangerousToolPolicyConfig {
  const parsed = asObject(value);
  const mode = parsed?.mode === "block" ? "block" : "audit";
  return {
    enabled: parsed?.enabled === true,
    mode,
  };
}

class ConfigManager {
  get<T>(key: string): T | undefined {
    const stored = tables.config.get(key);
    if (stored) {
      return parseJsonValue(stored.value) as T;
    }
    return undefined;
  }

  set<T>(key: string, value: T): void {
    tables.config.set(key, JSON.stringify(value));
  }

  getAll(): PlatformConfig {
    const defaults: PlatformConfig = {
      name: "Cybara",
      host: "0.0.0.0",
      port: 4269,
      dangerous_tool_policy: { ...DEFAULT_DANGEROUS_TOOL_POLICY },
    };

    const all = tables.config.all();
    const config: PlatformConfig = { ...defaults };

    for (const { key, value } of all) {
      config[key] = parseJsonValue(value);
    }
    return config;
  }

  getDangerousToolPolicy(): DangerousToolPolicyConfig {
    const stored = this.get<unknown>("dangerous_tool_policy");
    return normalizeDangerousToolPolicy(stored);
  }

  setDangerousToolPolicy(policy: unknown): DangerousToolPolicyConfig {
    const normalized = normalizeDangerousToolPolicy(policy);
    this.set("dangerous_tool_policy", normalized);
    return normalized;
  }

  isSetupComplete(): boolean {
    return tables.setup.isComplete();
  }

  completeSetup(): void {
    tables.setup.setStep(
      "wizard",
      true,
      JSON.stringify({ completed_at: new Date().toISOString() })
    );
  }

  getSetupStep(): string {
    const step = tables.setup.getStep("wizard") as { config?: string } | null;
    if (!step) return "welcome";
    const parsed = step.config ? parseJsonValue(step.config) : {};
    const stepConfig = asObject(parsed);
    return typeof stepConfig?.current_step === "string" ? stepConfig.current_step : "welcome";
  }
}

export const config = new ConfigManager();
