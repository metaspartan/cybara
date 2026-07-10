import { inspectAcpServer, runAcpServer } from "./core/acp/server";

function printAcpHelp(): void {
  process.stderr.write(
    [
      "Usage: cybara acp [--agent <id>] [--check]",
      "",
      "Runs the ACP v1 server over newline-delimited JSON-RPC on stdio.",
      "Protocol messages use stdout. Diagnostics use stderr.",
      "",
    ].join("\n")
  );
}

export async function runAcpCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printAcpHelp();
    return;
  }
  const agentIdx = args.indexOf("--agent");
  const agentId = agentIdx >= 0 ? args[agentIdx + 1] : undefined;
  const check = args.includes("--check");
  if (agentIdx >= 0 && !agentId) {
    throw new Error("--agent requires an agent ID");
  }
  const supportedArgs = new Set(
    ["--agent", agentId, "--check"].filter((value): value is string => !!value)
  );
  const unknown = args.find((arg) => !supportedArgs.has(arg));
  if (unknown) throw new Error(`Unknown ACP option: ${unknown}`);

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const redirect = (...values: unknown[]): void => {
    process.stderr.write(`${values.map(String).join(" ")}\n`);
  };
  console.log = redirect;
  console.info = redirect;
  console.debug = redirect;
  try {
    if (check) {
      const status = inspectAcpServer(agentId ? { agentId } : undefined);
      process.stdout.write(
        status.ready && status.agent
          ? `ACP v${status.protocolVersion} ready\nAgent: ${status.agent.name} (${status.agent.id})\nModel: ${status.agent.model}\nTransport: ${status.transport}\n`
          : `ACP v${status.protocolVersion} not ready\nNo matching agent is configured.\n`
      );
      return;
    }
    await runAcpServer(agentId ? { agentId } : undefined);
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
  }
}
