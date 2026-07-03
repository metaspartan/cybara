import { randomUUID } from "crypto";
import { agentManager } from "../agent";
import {
  parseJsonRpc,
  isNotification,
  jsonRpcResult,
  jsonRpcError,
  initializeResult,
  agentMessageChunk,
  promptResult,
  extractPromptText,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";

export interface AcpDeps {
  write: (message: JsonRpcRequest | JsonRpcResponse) => void;
  resolveAgentId: () => string | undefined;
  sendMessage: (agentId: string, text: string) => Promise<string>;
  newSessionId?: () => string;
}

export function createAcpDispatcher(deps: AcpDeps): (line: string) => Promise<void> {
  const sessions = new Map<string, { agentId: string }>();
  const newSessionId = deps.newSessionId ?? (() => randomUUID());

  return async function dispatch(line: string): Promise<void> {
    const req = parseJsonRpc(line);
    if (!req) return;
    const notification = isNotification(req);

    try {
      switch (req.method) {
        case "initialize":
          deps.write(jsonRpcResult(req.id, initializeResult()));
          return;

        case "authenticate":
          deps.write(jsonRpcResult(req.id, {}));
          return;

        case "session/new": {
          const agentId = deps.resolveAgentId();
          if (!agentId) {
            deps.write(
              jsonRpcError(req.id, -32603, "No agent is configured to serve ACP sessions")
            );
            return;
          }
          const sessionId = newSessionId();
          sessions.set(sessionId, { agentId });
          deps.write(jsonRpcResult(req.id, { sessionId }));
          return;
        }

        case "session/prompt": {
          const params = req.params as { sessionId?: string } | undefined;
          const session = params?.sessionId ? sessions.get(params.sessionId) : undefined;
          if (!session || !params?.sessionId) {
            deps.write(jsonRpcError(req.id, -32602, "Unknown or missing sessionId"));
            return;
          }
          const text = extractPromptText(req.params);
          if (!text) {
            deps.write(jsonRpcResult(req.id, promptResult("end_turn")));
            return;
          }
          const response = await deps.sendMessage(session.agentId, text);
          if (response) {
            deps.write(agentMessageChunk(params.sessionId, response));
          }
          deps.write(jsonRpcResult(req.id, promptResult("end_turn")));
          return;
        }

        case "session/cancel":
          return;

        default:
          if (!notification) {
            deps.write(jsonRpcError(req.id, -32601, `Method not found: ${req.method}`));
          }
          return;
      }
    } catch (error) {
      if (!notification) {
        deps.write(
          jsonRpcError(
            req.id ?? null,
            -32603,
            error instanceof Error ? error.message : "internal error"
          )
        );
      }
    }
  };
}

export async function runAcpServer(opts?: { agentId?: string }): Promise<void> {
  const dispatch = createAcpDispatcher({
    write: (message) => process.stdout.write(JSON.stringify(message) + "\n"),
    resolveAgentId: () => {
      if (opts?.agentId) return opts.agentId;
      const all = agentManager.list();
      const preferred = all.find((a) => a.type === "main") || all[0];
      return preferred?.id;
    },
    sendMessage: async (agentId, text) => {
      const result = await agentManager.message(agentId, text);
      return result.response || "";
    },
  });

  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      await dispatch(line);
    }
  }
}
