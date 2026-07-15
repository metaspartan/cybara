import { config } from "./config";

export type ToolCapability =
  | "read"
  | "write"
  | "execution"
  | "network"
  | "browser"
  | "wallet"
  | "destructive";

export type ToolCapabilityPolicyMode = "inherit" | "ask" | "allow" | "deny";

export type ToolCapabilityPolicy = Record<ToolCapability, ToolCapabilityPolicyMode>;

export interface ToolCapabilityDecision {
  capabilities: ToolCapability[];
  mode: ToolCapabilityPolicyMode;
}

export const TOOL_CAPABILITIES: readonly ToolCapability[] = [
  "read",
  "write",
  "execution",
  "network",
  "browser",
  "wallet",
  "destructive",
];

export const DEFAULT_TOOL_CAPABILITY_POLICY: ToolCapabilityPolicy = {
  read: "inherit",
  write: "inherit",
  execution: "inherit",
  network: "inherit",
  browser: "inherit",
  wallet: "inherit",
  destructive: "inherit",
};

const MODES = new Set<ToolCapabilityPolicyMode>(["inherit", "ask", "allow", "deny"]);
const DESTRUCTIVE_TOOL_NAMES = new Set([
  "delete",
  "file_delete",
  "session_delete",
  "kill_process",
  "wallet_send",
]);
const DESTRUCTIVE_COMMAND =
  /(?:^|[;&|\s])(rm|rmdir|del|erase|format|diskpart|shutdown|reboot|mkfs|dd|Remove-Item|Clear-Disk|Stop-Computer)(?:\s|$)|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeToolCapabilityPolicy(value: unknown): ToolCapabilityPolicy {
  const record = asRecord(value);
  return Object.fromEntries(
    TOOL_CAPABILITIES.map((capability) => {
      const mode = record[capability];
      return [
        capability,
        typeof mode === "string" && MODES.has(mode as ToolCapabilityPolicyMode) ? mode : "inherit",
      ];
    })
  ) as ToolCapabilityPolicy;
}

export function getToolCapabilityPolicy(): ToolCapabilityPolicy {
  return normalizeToolCapabilityPolicy(config.get<unknown>("tool_capability_policy"));
}

export function setToolCapabilityPolicy(value: unknown): ToolCapabilityPolicy {
  const policy = normalizeToolCapabilityPolicy(value);
  config.set("tool_capability_policy", policy);
  return policy;
}

function textArg(args: Record<string, unknown>, keys: readonly string[]): string {
  return keys
    .map((key) => args[key])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function isDestructiveToolCall(name: string, args: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_TOOL_NAMES.has(name)) return true;
  if (name === "wallet") {
    const action = typeof args.action === "string" ? args.action.toLowerCase() : "";
    return /send|transfer|swap_execute|sign|contract_write|program_instruction|x402/.test(action);
  }
  if (name === "process" && args.action === "kill") return true;
  if (name === "git") {
    return DESTRUCTIVE_COMMAND.test(`git ${textArg(args, ["command", "args"])}`);
  }
  if (["exec", "shell"].includes(name)) {
    return DESTRUCTIVE_COMMAND.test(textArg(args, ["command"]));
  }
  return false;
}

export function classifyToolCapabilities(
  name: string,
  args: Record<string, unknown>,
  permissions: readonly string[]
): ToolCapability[] {
  const capabilities = new Set<ToolCapability>();
  for (const permission of permissions) {
    if (permission.startsWith("fs:read") || permission.startsWith("memory:read")) {
      capabilities.add("read");
    }
    if (permission.startsWith("fs:write") || permission.startsWith("memory:write")) {
      capabilities.add("write");
    }
    if (permission.startsWith("exec:")) capabilities.add("execution");
    if (permission.startsWith("net:") || permission.startsWith("channel:")) {
      capabilities.add("network");
    }
    if (permission.startsWith("browser:") || permission.startsWith("computer:")) {
      capabilities.add("browser");
    }
    if (permission.startsWith("wallet:")) capabilities.add("wallet");
  }
  if (name === "browser" || name.startsWith("computer_")) capabilities.add("browser");
  if (name === "wallet") capabilities.add("wallet");
  if (isDestructiveToolCall(name, args)) capabilities.add("destructive");
  return [...capabilities];
}

export function resolveToolCapabilityDecision(
  name: string,
  args: Record<string, unknown>,
  permissions: readonly string[]
): ToolCapabilityDecision {
  const policy = getToolCapabilityPolicy();
  const capabilities = classifyToolCapabilities(name, args, permissions);
  const modes = capabilities.map((capability) => policy[capability]);
  const mode = modes.includes("deny")
    ? "deny"
    : modes.includes("ask")
      ? "ask"
      : modes.includes("allow")
        ? "allow"
        : "inherit";
  return { capabilities, mode };
}
