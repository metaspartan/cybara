import { runAcpServer } from "./core/acp/server";

export async function runAcpCommand(args: string[]): Promise<void> {
  const agentIdx = args.indexOf("--agent");
  const agentId = agentIdx >= 0 ? args[agentIdx + 1] : undefined;
  await runAcpServer(agentId ? { agentId } : undefined);
}
