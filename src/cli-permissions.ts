export interface CliPermissionsDependencies {
  fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null>;
}

const CAPABILITIES = [
  "read",
  "write",
  "execution",
  "network",
  "browser",
  "wallet",
  "destructive",
] as const;
const MODES = ["inherit", "ask", "allow", "deny"] as const;

type Capability = (typeof CAPABILITIES)[number];
type Mode = (typeof MODES)[number];
type Policy = Record<Capability, Mode>;

function isCapability(value: string): value is Capability {
  return CAPABILITIES.some((capability) => capability === value);
}

function isMode(value: string): value is Mode {
  return MODES.some((mode) => mode === value);
}

function printPolicy(policy: Policy): void {
  console.log("Capability Access");
  for (const capability of CAPABILITIES) {
    console.log(`  ${capability.padEnd(12)} ${policy[capability]}`);
  }
}

export async function runPermissionsCommand(
  args: string[],
  dependencies: CliPermissionsDependencies
): Promise<void> {
  const current = await dependencies.fetchAPI<{ policy: Policy }>(
    "/api/settings/tool-capabilities"
  );
  if (!current) throw new Error("Capability policy is unavailable");
  if (args.length === 0 || args[0] === "status" || args[0] === "show") {
    printPolicy(current.policy);
    return;
  }
  const capability = args[0]?.toLowerCase() ?? "";
  const requestedMode = args[1]?.toLowerCase() ?? "";
  const mode = requestedMode === "default" ? "inherit" : requestedMode;
  if (!isCapability(capability) || !isMode(mode)) {
    console.log("Usage: cybara permissions <capability> <default|ask|allow|deny>");
    console.log(`Capabilities: ${CAPABILITIES.join(", ")}`);
    return;
  }
  const result = await dependencies.fetchAPI<{ policy: Policy }>(
    "/api/settings/tool-capabilities",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...current.policy,
        [capability]: mode,
      }),
    }
  );
  if (!result) throw new Error("Capability policy update failed");
  printPolicy(result.policy);
}
