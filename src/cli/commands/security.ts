import { resolve } from "node:path";
import { rawAgent } from "./chat";

export interface SecurityCommandRuntime {
  runAgent(args: string[]): Promise<void>;
}

const defaultRuntime: SecurityCommandRuntime = {
  async runAgent(args) {
    await rawAgent(args);
  },
};

export function securityCommandHelp(): string {
  return [
    "Usage: cybara security [scan] [path] [options]",
    "",
    "Runs an authorized security assessment with the selected Cybara agent.",
    "",
    "Options:",
    "  --agent, -a <id>       Select an agent by name or ID",
    "  --router               Use the configured model router",
    "  --deep                 Request a deep multi-pass assessment",
    "  --working-tree         Focus on staged and unstaged changes",
    "  --diff <ref>           Focus on changes from a Git base ref",
    "  --path <path>          Focus the assessment on a repository path",
    "  --workspace, -w <path> Set the active workspace",
    "  --json                 Print the chat response as JSON",
  ].join("\n");
}

export function buildSecurityAgentArgs(args: string[], cwd = process.cwd()): string[] {
  const normalized = args[0] === "scan" ? args.slice(1) : [...args];
  const agentArgs: string[] = [];
  const request: string[] = [];
  let target = cwd;
  let workspace = cwd;

  for (let index = 0; index < normalized.length; index++) {
    const value = normalized[index];
    if (value === "--agent" || value === "-a") {
      const agent = normalized[++index];
      if (!agent) throw new Error(`${value} requires an agent name or ID.`);
      agentArgs.push("--agent", agent);
      continue;
    }
    if (value === "--workspace" || value === "-w") {
      const selectedWorkspace = normalized[++index];
      if (!selectedWorkspace) throw new Error(`${value} requires a path.`);
      workspace = resolve(cwd, selectedWorkspace);
      continue;
    }
    if (value === "--router" || value === "--json") {
      agentArgs.push(value);
      continue;
    }
    if (value === "--deep") {
      request.push("Use a deep, exhaustive, multi-pass assessment.");
      continue;
    }
    if (value === "--working-tree") {
      request.push("Focus on staged and unstaged working-tree changes.");
      continue;
    }
    if (value === "--diff" || value === "--path") {
      const selected = normalized[++index];
      if (!selected) throw new Error(`${value} requires a value.`);
      request.push(
        value === "--diff"
          ? `Focus on changes from Git base ${selected}.`
          : `Focus the assessment on ${selected}.`
      );
      continue;
    }
    if (!value.startsWith("-") && target === cwd) {
      target = resolve(cwd, value);
      continue;
    }
    throw new Error(`Unsupported security option: ${value}`);
  }

  return [
    `/security ${target}${request.length > 0 ? `\n${request.join("\n")}` : ""}`,
    "--workspace",
    workspace,
    ...agentArgs,
  ];
}

export async function runSecurityCommand(
  args: string[],
  runtime: SecurityCommandRuntime = defaultRuntime,
  cwd = process.cwd()
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(securityCommandHelp());
    return 0;
  }
  try {
    await runtime.runAgent(buildSecurityAgentArgs(args, cwd));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to run the security assessment: ${message}`);
    return 1;
  }
}
