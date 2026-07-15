interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export const STRICT_MCP_FIXTURE_MARKER = "MCP_E2E";

let initialized = false;
let buffer = "";

function send(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

async function handle(request: JsonRpcRequest): Promise<void> {
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "strict-test", version: "1.0.0" },
      },
    });
    return;
  }
  if (request.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (!initialized) {
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32002, message: "Server is not initialized" },
    });
    return;
  }
  if (request.method === "tools/list") {
    await Bun.sleep(150);
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        tools: [
          {
            name: "uppercase",
            description: "Returns the supplied text in uppercase with a stable marker",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      },
    });
    return;
  }
  if (request.method === "tools/call") {
    const toolArguments = request.params?.arguments;
    const text =
      toolArguments && typeof toolArguments === "object" && "text" in toolArguments
        ? String((toolArguments as { text?: unknown }).text ?? "")
        : "";
    await Bun.sleep(text.length % 7);
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        content: [{ type: "text", text: `${STRICT_MCP_FIXTURE_MARKER}:${text.toUpperCase()}` }],
      },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: request.id ?? null,
    error: { code: -32601, message: "Method not found" },
  });
}

if (import.meta.main) {
  for await (const chunk of Bun.stdin.stream()) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      void handle(JSON.parse(trimmed) as JsonRpcRequest);
    }
  }
}
