import { tables } from "./database";
import { normalizeReasoningEffort } from "./llm/reasoning";

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
export type EmbeddingProviderPreference =
  "auto" | "openai" | "gemini" | "ollama" | "transformers_js";
export type SpeechTtsProviderPreference = "auto" | "system" | "elevenlabs" | "openai";
export type SpeechSttProviderPreference = "auto" | "openai";

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

export interface WorkspaceIndexerSettings {
  enabled: boolean;
  autoReindexOnWorkspaceSet: boolean;
  includeHidden: boolean;
  maxFileSizeBytes: number;
  maxFiles: number;
  semanticEnabled: boolean;
  semanticMaxFiles: number;
  semanticMinScore: number;
  embeddingProvider: EmbeddingProviderPreference;
  embeddingModel: string;
  ignoreDirs: string[];
  includeExtensions: string[];
}

export interface SpeechTtsSettings {
  provider: SpeechTtsProviderPreference;
  providerId: string;
  model: string;
  voice: string;
  outputFormat: "mp3" | "m4a" | "wav" | "aiff" | "opus" | "aac";
  speed: number;
  maxTextLength: number;
  fallbackToSystem: boolean;
}

export interface SpeechSttSettings {
  provider: SpeechSttProviderPreference;
  providerId: string;
  model: string;
  language: string;
}

export interface SpeechSettings {
  tts: SpeechTtsSettings;
  stt: SpeechSttSettings;
}

export interface ComputerUseSettings {
  driverCommand: string;
}

export const DEFAULT_DANGEROUS_TOOL_POLICY: DangerousToolPolicyConfig = {
  enabled: false,
  mode: "audit",
};

export const DEFAULT_TOOL_APPROVAL_MODE: ToolApprovalMode = "ask";

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

export const DEFAULT_WORKSPACE_INDEXER_SETTINGS: WorkspaceIndexerSettings = {
  enabled: true,
  autoReindexOnWorkspaceSet: true,
  includeHidden: false,
  maxFileSizeBytes: 1024 * 1024,
  maxFiles: 25000,
  semanticEnabled: true,
  semanticMaxFiles: 2000,
  semanticMinScore: 0.45,
  embeddingProvider: "auto",
  embeddingModel: "",
  ignoreDirs: [
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".idea",
    ".vscode",
    "__pycache__",
    ".venv",
    "venv",
  ],
  includeExtensions: [],
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  tts: {
    provider: "auto",
    providerId: "",
    model: "",
    voice: "",
    outputFormat: "mp3",
    speed: 1,
    maxTextLength: 8000,
    fallbackToSystem: true,
  },
  stt: {
    provider: "auto",
    providerId: "",
    model: "",
    language: "",
  },
};

export const DEFAULT_COMPUTER_USE_SETTINGS: ComputerUseSettings = {
  driverCommand: "",
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
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
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

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  minimum = 1,
  maximum = 1_000_000
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizeExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return [...new Set(normalized)];
}

function normalizeEmbeddingProvider(value: unknown): EmbeddingProviderPreference {
  if (typeof value !== "string") return DEFAULT_WORKSPACE_INDEXER_SETTINGS.embeddingProvider;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "auto" ||
    normalized === "openai" ||
    normalized === "gemini" ||
    normalized === "ollama" ||
    normalized === "transformers_js"
  ) {
    return normalized as EmbeddingProviderPreference;
  }
  if (normalized === "transformers") {
    return "transformers_js";
  }
  return DEFAULT_WORKSPACE_INDEXER_SETTINGS.embeddingProvider;
}

function normalizeEmbeddingModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_WORKSPACE_INDEXER_SETTINGS.embeddingModel;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 160);
}

function normalizeSpeechTtsProvider(value: unknown): SpeechTtsProviderPreference {
  if (typeof value !== "string") return DEFAULT_SPEECH_SETTINGS.tts.provider;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "system" || normalized === "macos" || normalized === "local") {
    return "system";
  }
  if (normalized === "elevenlabs" || normalized === "eleven_labs") return "elevenlabs";
  if (normalized === "openai" || normalized === "openai_codex" || normalized === "codex") {
    return "openai";
  }
  return "auto";
}

function normalizeSpeechSttProvider(value: unknown): SpeechSttProviderPreference {
  if (typeof value !== "string") return DEFAULT_SPEECH_SETTINGS.stt.provider;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized === "openai" || normalized === "openai_codex" || normalized === "codex"
    ? "openai"
    : "auto";
}

function normalizeShortText(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeCommandText(value: unknown, maxLength = 700): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, maxLength);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeComputerUseSettings(value: unknown): ComputerUseSettings {
  const parsed = asObject(value);
  const raw =
    parsed?.driverCommand ??
    parsed?.command ??
    parsed?.driverPath ??
    parsed?.driver_command ??
    (typeof value === "string" ? value : undefined);
  return {
    driverCommand: normalizeCommandText(raw),
  };
}

function normalizeSpeechOutputFormat(value: unknown): SpeechTtsSettings["outputFormat"] {
  if (typeof value !== "string") return DEFAULT_SPEECH_SETTINGS.tts.outputFormat;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "mp3" ||
    normalized === "m4a" ||
    normalized === "wav" ||
    normalized === "aiff" ||
    normalized === "opus" ||
    normalized === "aac"
  ) {
    return normalized;
  }
  return DEFAULT_SPEECH_SETTINGS.tts.outputFormat;
}

function normalizeSpeechSpeed(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_SPEECH_SETTINGS.tts.speed;
  return Math.min(2, Math.max(0.5, Number(parsed.toFixed(2))));
}

function normalizeSpeechSettings(value: unknown): SpeechSettings {
  const parsed = asObject(value);
  const tts = asObject(parsed?.tts);
  const stt = asObject(parsed?.stt);
  return {
    tts: {
      provider: normalizeSpeechTtsProvider(tts?.provider),
      providerId: normalizeShortText(tts?.providerId),
      model: normalizeShortText(tts?.model),
      voice: normalizeShortText(tts?.voice),
      outputFormat: normalizeSpeechOutputFormat(tts?.outputFormat),
      speed: normalizeSpeechSpeed(tts?.speed),
      maxTextLength: normalizePositiveInteger(
        tts?.maxTextLength,
        DEFAULT_SPEECH_SETTINGS.tts.maxTextLength,
        1,
        50_000
      ),
      fallbackToSystem:
        typeof tts?.fallbackToSystem === "boolean"
          ? tts.fallbackToSystem
          : DEFAULT_SPEECH_SETTINGS.tts.fallbackToSystem,
    },
    stt: {
      provider: normalizeSpeechSttProvider(stt?.provider),
      providerId: normalizeShortText(stt?.providerId),
      model: normalizeShortText(stt?.model),
      language: normalizeShortText(stt?.language, 20).toLowerCase(),
    },
  };
}

function normalizeWorkspaceIndexerSettings(value: unknown): WorkspaceIndexerSettings {
  const parsed = asObject(value);
  const rawSemanticMinScore =
    typeof parsed?.semanticMinScore === "number"
      ? parsed.semanticMinScore
      : typeof parsed?.semanticMinScore === "string" && parsed.semanticMinScore.trim().length > 0
        ? Number(parsed.semanticMinScore)
        : Number.NaN;
  const semanticMinScore = Number.isFinite(rawSemanticMinScore)
    ? Math.min(0.99, Math.max(0.05, rawSemanticMinScore))
    : DEFAULT_WORKSPACE_INDEXER_SETTINGS.semanticMinScore;

  return {
    enabled:
      typeof parsed?.enabled === "boolean"
        ? parsed.enabled
        : DEFAULT_WORKSPACE_INDEXER_SETTINGS.enabled,
    autoReindexOnWorkspaceSet:
      typeof parsed?.autoReindexOnWorkspaceSet === "boolean"
        ? parsed.autoReindexOnWorkspaceSet
        : DEFAULT_WORKSPACE_INDEXER_SETTINGS.autoReindexOnWorkspaceSet,
    includeHidden:
      typeof parsed?.includeHidden === "boolean"
        ? parsed.includeHidden
        : DEFAULT_WORKSPACE_INDEXER_SETTINGS.includeHidden,
    maxFileSizeBytes: normalizePositiveInteger(
      parsed?.maxFileSizeBytes,
      DEFAULT_WORKSPACE_INDEXER_SETTINGS.maxFileSizeBytes,
      8 * 1024,
      100 * 1024 * 1024
    ),
    maxFiles: normalizePositiveInteger(
      parsed?.maxFiles,
      DEFAULT_WORKSPACE_INDEXER_SETTINGS.maxFiles,
      100,
      1_000_000
    ),
    semanticEnabled:
      typeof parsed?.semanticEnabled === "boolean"
        ? parsed.semanticEnabled
        : DEFAULT_WORKSPACE_INDEXER_SETTINGS.semanticEnabled,
    semanticMaxFiles: normalizePositiveInteger(
      parsed?.semanticMaxFiles,
      DEFAULT_WORKSPACE_INDEXER_SETTINGS.semanticMaxFiles,
      100,
      50_000
    ),
    semanticMinScore,
    embeddingProvider: normalizeEmbeddingProvider(parsed?.embeddingProvider),
    embeddingModel: normalizeEmbeddingModel(parsed?.embeddingModel),
    ignoreDirs:
      normalizeStringList(parsed?.ignoreDirs).length > 0
        ? normalizeStringList(parsed?.ignoreDirs)
        : [...DEFAULT_WORKSPACE_INDEXER_SETTINGS.ignoreDirs],
    includeExtensions: normalizeExtensions(parsed?.includeExtensions),
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
      host: "127.0.0.1",
      port: 4269,
      dangerous_tool_policy: { ...DEFAULT_DANGEROUS_TOOL_POLICY },
      tool_approval_mode: DEFAULT_TOOL_APPROVAL_MODE,
      web_tool_url_policy: { ...DEFAULT_WEB_TOOL_URL_POLICY },
      sandbox_runtime: { ...DEFAULT_SANDBOX_RUNTIME },
      workspace_indexer: { ...DEFAULT_WORKSPACE_INDEXER_SETTINGS },
      speech: { ...DEFAULT_SPEECH_SETTINGS },
      computer_use: { ...DEFAULT_COMPUTER_USE_SETTINGS },
    };

    const all = tables.config.all();
    const config: PlatformConfig = { ...defaults };

    for (const { key, value } of all) {
      config[key] = parseJsonValue(value);
    }
    return config;
  }

  getDefaultReasoningEffort(): string {
    return normalizeReasoningEffort(this.get<unknown>("reasoning_effort")) || "";
  }

  setDefaultReasoningEffort(value: unknown): string {
    const normalized = normalizeReasoningEffort(value) || "";
    this.set("reasoning_effort", normalized);
    return normalized;
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

  getWorkspaceIndexerSettings(): WorkspaceIndexerSettings {
    const stored = this.get<unknown>("workspace_indexer");
    return normalizeWorkspaceIndexerSettings(stored);
  }

  setWorkspaceIndexerSettings(settings: unknown): WorkspaceIndexerSettings {
    const normalized = normalizeWorkspaceIndexerSettings(settings);
    this.set("workspace_indexer", normalized);
    return normalized;
  }

  getSpeechSettings(): SpeechSettings {
    const stored = this.get<unknown>("speech");
    return normalizeSpeechSettings(stored);
  }

  setSpeechSettings(settings: unknown): SpeechSettings {
    const normalized = normalizeSpeechSettings(settings);
    this.set("speech", normalized);
    return normalized;
  }

  getComputerUseSettings(): ComputerUseSettings {
    const stored = this.get<unknown>("computer_use");
    return normalizeComputerUseSettings(stored);
  }

  setComputerUseSettings(settings: unknown): ComputerUseSettings {
    const normalized = normalizeComputerUseSettings(settings);
    this.set("computer_use", normalized);
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
