/**
 * MCP host-as-server: expose cybara's own tools as an MCP server over stdio.
 *
 * Cybara already *consumes* MCP servers (src/core/mcp.ts). This is the inverse:
 * it lets other MCP clients (Claude Desktop, other agents, IDEs) connect to
 * cybara and call its built-in tools (read/write/exec/grep/...). Speaks the
 * standard MCP JSON-RPC protocol over stdio so any compliant client works.
 *
 * Enabled via `cybara mcp serve` (see cli.tsx). Reads newline-delimited
 * JSON-RPC from stdin and writes responses to stdout. Methods implemented:
 *   - initialize / initialized (handshake + capabilities)
 *   - tools/list          (enumerate cybara tools)
 *   - tools/call          (dispatch to the cybara tool handler)
 *   - ping
 */
import { createInterface, type Interface } from "readline";
import { executeTool, toolSchemas } from "./tools/handlers/index";
import {
  getToolSchemasForLLM,
  type ToolContext,
  type Tool as CybaraTool,
} from "./tools/index";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "cybara";
const SERVER_VERSION = "1.0.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> | null;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function makeResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

/** Convert a cybara tool schema into the MCP tool-list shape. */
function toMcpTool(tool: CybaraTool): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema as Record<string, unknown>,
  };
}

/** Build the workspace tool context. Kept permissive — host tools are trusted. */
function buildContext(params: Record<string, unknown> | null | undefined): ToolContext {
  const meta =
    params && typeof params === "object" && params._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : {};
  return {
    agentId: "mcp-host",
    sessionId: typeof meta.sessionId === "string" ? meta.sessionId : undefined,
    workspaceDir: typeof meta.workspaceDir === "string" ? meta.workspaceDir : undefined,
    allowDangerousTools: true,
  };
}

function buildInitializeResult(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
}

/** Handle a single JSON-RPC request and return a response (or null for notifications). */
async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      return makeResponse(id, buildInitializeResult());

    case "notifications/initialized":
      // Notification — no response.
      return null;

    case "ping":
      return makeResponse(id, {});

    case "tools/list": {
      const tools = getToolSchemasForLLM().map(toMcpTool);
      return makeResponse(id, { tools });
    }

    case "tools/call": {
      const params = req.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (!name) {
        return makeError(id, ERROR_CODES.INVALID_PARAMS, "Missing tool 'name'");
      }
      if (!toolSchemas[name as keyof typeof toolSchemas]) {
        return makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
      }
      try {
        const context = buildContext(params);
        const result = await executeTool(name, args, context);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return makeResponse(id, {
          content: [{ type: "text", text }],
          isError: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return makeResponse(id, {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        });
      }
    }

    default:
      return makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
  }
}

/**
 * Run the MCP stdio server. Reads JSON-RPC lines from stdin, writes responses
 * to stdout. Returns when stdin closes. Safe to run as `cybara mcp serve`.
 */
export async function runMcpStdioServer(): Promise<void> {
  const rl: Interface = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify(makeError(null, ERROR_CODES.PARSE_ERROR, "Invalid JSON"))}\n`
      );
      continue;
    }

    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      process.stdout.write(
        `${JSON.stringify(
          makeError(req.id ?? null, ERROR_CODES.INVALID_REQUEST, "Not a valid JSON-RPC 2.0 request")
        )}\n`
      );
      continue;
    }

    try {
      const response = await handleRequest(req);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(
        `${JSON.stringify(makeError(req.id ?? null, ERROR_CODES.INTERNAL_ERROR, message))}\n`
      );
    }
  }
}
