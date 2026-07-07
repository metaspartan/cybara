export const ACP_PROTOCOL_VERSION = 1;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const AGENT_CAPABILITIES = {
  loadSession: false,
  promptCapabilities: {
    image: true,
    audio: false,
    embeddedContext: true,
  },
} as const;

export function parseJsonRpc(line: string): JsonRpcRequest | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && obj.jsonrpc === "2.0" && typeof obj.method === "string") {
      return obj as JsonRpcRequest;
    }
    return null;
  } catch {
    return null;
  }
}

export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || req.id === null;
}

export function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
}

export const ACP_AUTH_METHODS: AcpAuthMethod[] = [];

export function isSupportedAuthMethod(methodId: string): boolean {
  return ACP_AUTH_METHODS.some((m) => m.id === methodId);
}

export function initializeResult() {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentCapabilities: AGENT_CAPABILITIES,
    authMethods: ACP_AUTH_METHODS,
  };
}

export function agentMessageChunk(sessionId: string, text: string): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  };
}

export function promptResult(stopReason: string = "end_turn") {
  return { stopReason };
}

export function extractPromptText(params: unknown): string {
  const prompt = (params as { prompt?: Array<{ type?: string; text?: string }> })?.prompt;
  if (!Array.isArray(prompt)) return "";
  return prompt
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}
