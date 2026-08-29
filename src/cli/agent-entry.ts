import { configureChatCli, rawAgent } from "./commands/chat";
import { CLI_API_BASE, fetchCliAPI, requestLongRunningCliAPI, withCliAuthHeaders } from "./client";

export async function runAgentCli(args: string[]): Promise<void> {
  configureChatCli({
    apiBase: CLI_API_BASE,
    fetchAPI: fetchCliAPI,
    requestAPI: requestLongRunningCliAPI,
    withAuthHeaders: withCliAuthHeaders,
  });
  await rawAgent(args);
}
