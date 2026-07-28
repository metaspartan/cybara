import { randomUUID } from "crypto";
import { isAbsolute } from "path";
import { agentManager } from "../agent";
import type { AgentMessage } from "../agent";
import { getAppVersion } from "../build-info";
import {
  parseJsonRpc,
  isNotification,
  jsonRpcResult,
  jsonRpcError,
  initializeResult,
  agentMessageChunk,
  promptResult,
  extractPromptText,
  isSupportedAuthMethod,
  ACP_PROTOCOL_VERSION,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";

export interface AcpDeps {
  write: (message: JsonRpcRequest | JsonRpcResponse) => void;
  resolveAgentId: () => string | undefined;
  sendMessage: (request: AcpPromptRequest) => Promise<string>;
  newSessionId?: () => string;
  agentVersion?: string;
}

export interface AcpPromptRequest {
  agentId: string;
  sessionId: string;
  text: string;
  cwd: string;
  messages: AgentMessage[];
  signal: AbortSignal;
}

interface AcpSession {
  agentId: string;
  cwd: string;
  messages: AgentMessage[];
  activePrompt?: AbortController;
}

export interface AcpServerStatus {
  ready: boolean;
  protocolVersion: number;
  agent: { id: string; name: string; model: string } | null;
  transport: "stdio";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveAcpAgent(agentId?: string) {
  if (agentId) return agentManager.get(agentId);
  const agents = agentManager.list();
  return (
    agents.find((agent) => agent.type === "main") ||
    agents.find((agent) => agent.type !== "subagent" && agent.type !== "worker")
  );
}

export function inspectAcpServer(opts?: { agentId?: string }): AcpServerStatus {
  const agent = resolveAcpAgent(opts?.agentId);
  return {
    ready: !!agent,
    protocolVersion: ACP_PROTOCOL_VERSION,
    agent: agent
      ? { id: agent.id, name: agent.name, model: agent.model || "gateway default" }
      : null,
    transport: "stdio",
  };
}

export function createAcpDispatcher(deps: AcpDeps): (line: string) => Promise<void> {
  const sessions = new Map<string, AcpSession>();
  const newSessionId = deps.newSessionId ?? (() => randomUUID());
  let initialized = false;

  return async function dispatch(line: string): Promise<void> {
    const req = parseJsonRpc(line);
    if (!req) return;
    const notification = isNotification(req);

    try {
      switch (req.method) {
        case "initialize":
          initialized = true;
          deps.write(jsonRpcResult(req.id, initializeResult(deps.agentVersion)));
          return;

        case "authenticate": {
          const authParams = req.params as { methodId?: string } | undefined;
          const methodId = authParams?.methodId;
          if (methodId && !isSupportedAuthMethod(methodId)) {
            deps.write(
              jsonRpcError(req.id, -32602, `Unsupported authentication method: ${methodId}`)
            );
            return;
          }
          deps.write(jsonRpcResult(req.id, {}));
          return;
        }

        case "session/new": {
          if (!initialized) {
            deps.write(jsonRpcError(req.id, -32002, "ACP connection is not initialized"));
            return;
          }
          const params = req.params as { cwd?: string } | undefined;
          const cwd = params?.cwd?.trim();
          if (!cwd || !isAbsolute(cwd)) {
            deps.write(jsonRpcError(req.id, -32602, "session/new requires an absolute cwd"));
            return;
          }
          const agentId = deps.resolveAgentId();
          if (!agentId) {
            deps.write(
              jsonRpcError(req.id, -32603, "No agent is configured to serve ACP sessions")
            );
            return;
          }
          const sessionId = newSessionId();
          sessions.set(sessionId, { agentId, cwd, messages: [] });
          deps.write(jsonRpcResult(req.id, { sessionId }));
          return;
        }

        case "session/prompt": {
          if (!initialized) {
            deps.write(jsonRpcError(req.id, -32002, "ACP connection is not initialized"));
            return;
          }
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
          if (session.activePrompt) {
            deps.write(
              jsonRpcError(req.id, -32600, "A prompt is already running for this session")
            );
            return;
          }
          const controller = new AbortController();
          session.activePrompt = controller;
          session.messages.push({ role: "user", content: text });
          try {
            const response = await deps.sendMessage({
              agentId: session.agentId,
              sessionId: params.sessionId,
              text,
              cwd: session.cwd,
              messages: [...session.messages],
              signal: controller.signal,
            });
            if (controller.signal.aborted) {
              session.messages.pop();
              deps.write(jsonRpcResult(req.id, promptResult("cancelled")));
              return;
            }
            if (response) {
              session.messages.push({ role: "assistant", content: response });
              deps.write(agentMessageChunk(params.sessionId, response));
            }
            deps.write(jsonRpcResult(req.id, promptResult("end_turn")));
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) {
              session.messages.pop();
              deps.write(jsonRpcResult(req.id, promptResult("cancelled")));
              return;
            }
            throw error;
          } finally {
            session.activePrompt = undefined;
          }
          return;
        }

        case "session/cancel": {
          const params = req.params as { sessionId?: string } | undefined;
          const session = params?.sessionId ? sessions.get(params.sessionId) : undefined;
          session?.activePrompt?.abort(new DOMException("ACP prompt cancelled", "AbortError"));
          return;
        }

        case "session/close": {
          if (!initialized) {
            deps.write(jsonRpcError(req.id, -32002, "ACP connection is not initialized"));
            return;
          }
          const params = req.params as { sessionId?: string } | undefined;
          const session = params?.sessionId ? sessions.get(params.sessionId) : undefined;
          if (!session || !params?.sessionId) {
            deps.write(jsonRpcError(req.id, -32602, "Unknown or missing sessionId"));
            return;
          }
          session.activePrompt?.abort(new DOMException("ACP session closed", "AbortError"));
          sessions.delete(params.sessionId);
          deps.write(jsonRpcResult(req.id, {}));
          return;
        }

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
  const originalWrite = process.stdout.write;
  const writeFrame = originalWrite.bind(process.stdout);
  const flushes = new Set<Promise<void>>();
  const emitFrame = (text: string): void => {
    const flush = new Promise<void>((resolve) => {
      writeFrame(text, () => resolve());
    });
    flushes.add(flush);
    void flush.finally(() => flushes.delete(flush));
  };
  const divertToStderr = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString("utf8")
          : String(chunk);
    process.stderr.write(text);
    const callback = rest.find((value) => typeof value === "function") as
      | ((error?: Error | null) => void)
      | undefined;
    callback?.(null);
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = divertToStderr;

  const dispatch = createAcpDispatcher({
    write: (message) => emitFrame(JSON.stringify(message) + "\n"),
    resolveAgentId: () => resolveAcpAgent(opts?.agentId)?.id,
    agentVersion: getAppVersion(),
    sendMessage: async ({ agentId, sessionId, messages, cwd, signal }) => {
      const result = await agentManager.execute(agentId, messages, {
        sessionId,
        workspaceDir: cwd,
        abortSignal: signal,
      });
      return result.content || "";
    },
  });

  let buffer = "";
  const pending = new Set<Promise<void>>();
  const dispatchLine = (line: string): void => {
    const task = dispatch(line).finally(() => pending.delete(task));
    pending.add(task);
  };
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      dispatchLine(line);
    }
  }
  if (buffer.trim()) dispatchLine(buffer);
  await Promise.all(pending);
  await Promise.all([...flushes]);
  process.stdout.write = originalWrite;
}
