import { tables } from "./database";

interface PlatformConfig {
  name: string;
  host: string;
  port: number;
  session_secret?: string;
  dangerous_tool_policy?: DangerousToolPolicyConfig;
  tool_approval_mode?: ToolApprovalMode;
  web_tool_url_policy?: WebToolUrlPolicyConfig;
  [key: string]: unknown;
}

export type DangerousToolPolicyMode = "audit" | "block";
export type ToolApprovalMode = "always_allow" | "ask";
export type SandboxProvider = "auto" | "apple_sandbox" | "podman" | "docker";
export type SandboxNetworkMode = "allow" | "deny";

export interface DangerousToolPolicyConfig {
  enabled: boolean;
  mode: DangerousToolPolicyMode;
}

export interface WebToolUrlPolicyConfig {
  enabled: boolean;
  fetch_allowlist: string[];
  search_result_allowlist: string[];
}

export interface SandboxRuntimeConfig {
  enabled: boolean;
  provider: SandboxProvider;
  network: SandboxNetworkMode;
}

export const DEFAULT_DANGEROUS_TOOL_POLICY: DangerousToolPolicyConfig = {
  enabled: false,
  mode: "audit",
};

export const DEFAULT_TOOL_APPROVAL_MODE: ToolApprovalMode = "always_allow";

export const DEFAULT_WEB_TOOL_URL_POLICY: WebToolUrlPolicyConfig = {
  enabled: false,
  fetch_allowlist: [],
  search_result_allowlist: [],
};

export const DEFAULT_SANDBOX_RUNTIME: SandboxRuntimeConfig = {
  enabled: false,
  provider: "auto",
  network: "deny",
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeDangerousToolPolicy(value: unknown): DangerousToolPolicyConfig {
  const parsed = asObject(value);
  const mode = parsed?.mode === "block" ? "block" : "audit";
  return {
    enabled: parsed?.enabled === true,
    mode,
  };
}

function normalizeToolApprovalMode(value: unknown): ToolApprovalMode {
  if (typeof value !== "string") return DEFAULT_TOOL_APPROVAL_MODE;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "ask" || normalized === "prompt" || normalized === "confirm") {
    return "ask";
  }
  if (
    normalized === "always_allow" ||
    normalized === "always" ||
    normalized === "allow" ||
    normalized === "auto"
  ) {
    return "always_allow";
  }
  return DEFAULT_TOOL_APPROVAL_MODE;
}

function normalizeWebToolUrlPolicy(value: unknown): WebToolUrlPolicyConfig {
  const parsed = asObject(value);
  return {
    enabled: parsed?.enabled === true,
    fetch_allowlist: normalizeStringList(parsed?.fetch_allowlist),
    search_result_allowlist: normalizeStringList(parsed?.search_result_allowlist),
  };
}

function normalizeSandboxProvider(value: unknown): SandboxProvider {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "apple_sandbox" || normalized === "apple") return "apple_sandbox";
  if (normalized === "podman") return "podman";
  if (normalized === "docker") return "docker";
  return "auto";
}

function normalizeSandboxNetwork(value: unknown): SandboxNetworkMode {
  if (typeof value !== "string") return "deny";
  const normalized = value.trim().toLowerCase();
  return normalized === "allow" ? "allow" : "deny";
}

function normalizeSandboxRuntime(value: unknown): SandboxRuntimeConfig {
  const parsed = asObject(value);
  return {
    enabled: parsed?.enabled === true,
    provider: normalizeSandboxProvider(parsed?.provider),
    network: normalizeSandboxNetwork(parsed?.network),
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
      tool_approval_mode: DEFAULT_TOOL_APPROVAL_MODE,
      web_tool_url_policy: { ...DEFAULT_WEB_TOOL_URL_POLICY },
      sandbox_runtime: { ...DEFAULT_SANDBOX_RUNTIME },
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

  getToolApprovalMode(): ToolApprovalMode {
    const stored = this.get<unknown>("tool_approval_mode");
    return normalizeToolApprovalMode(stored);
  }

  setToolApprovalMode(mode: unknown): ToolApprovalMode {
    const normalized = normalizeToolApprovalMode(mode);
    this.set("tool_approval_mode", normalized);
    return normalized;
  }

  getWebToolUrlPolicy(): WebToolUrlPolicyConfig {
    const stored = this.get<unknown>("web_tool_url_policy");
    return normalizeWebToolUrlPolicy(stored);
  }

  setWebToolUrlPolicy(policy: unknown): WebToolUrlPolicyConfig {
    const normalized = normalizeWebToolUrlPolicy(policy);
    this.set("web_tool_url_policy", normalized);
    return normalized;
  }

  getSandboxRuntime(): SandboxRuntimeConfig {
    const stored = this.get<unknown>("sandbox_runtime");
    return normalizeSandboxRuntime(stored);
  }

  setSandboxRuntime(runtime: unknown): SandboxRuntimeConfig {
    const normalized = normalizeSandboxRuntime(runtime);
    this.set("sandbox_runtime", normalized);
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
