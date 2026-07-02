import { tables, type MCPServer } from "./database";
import { spawn, ChildProcess } from "child_process";
import { parseMcpHttpResponse, isHttpMcpUrl } from "./mcp-http";
import { EventEmitter } from "events";

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPServerInstance {
  server: MCPServer;
  process: ChildProcess | null;
  tools: MCPTool[];
  status: "stopped" | "starting" | "running" | "error";
  lastError?: string;
  startedAt?: Date;
  httpSessionId?: string;
}

type MCPToolListResponse = {
  result?: {
    tools?: Array<{
      name?: string;
      description?: string;
      inputSchema?: unknown;
    }>;
  };
};

class MCPServerManager extends EventEmitter {
  private instances: Map<string, MCPServerInstance> = new Map();
  private toolCache: Map<string, MCPTool[]> = new Map();

  constructor() {
    super();
    this.loadFromDatabase();
  }

  private loadFromDatabase(): void {
    try {
      const servers = tables.mcpServers.all() as MCPServer[];
      for (const server of servers) {
        this.instances.set(server.id, {
          server,
          process: null,
          tools: [],
          status: "stopped",
        });
      }
    } catch (error) {
      console.error("[MCP] Failed to load servers from database:", error);
    }
  }

  list(): (MCPServer & { status: string; toolCount: number })[] {
    const result: (MCPServer & { status: string; toolCount: number })[] = [];

    for (const [, instance] of this.instances) {
      result.push({
        ...instance.server,
        status: instance.status,
        toolCount: instance.tools.length,
      });
    }

    return result;
  }

  get(id: string): MCPServer | undefined {
    return this.instances.get(id)?.server;
  }

  getStatus(id: string): { status: string; tools: MCPTool[]; error?: string } | undefined {
    const instance = this.instances.get(id);
    if (!instance) return undefined;

    return {
      status: instance.status,
      tools: instance.tools,
      error: instance.lastError,
    };
  }

  create(data: {
    name: string;
    command: string;
    args?: string;
    env?: string;
    enabled?: boolean;
  }): MCPServer {
    const id = crypto.randomUUID();
    const server: MCPServer = {
      id,
      name: data.name,
      command: data.command,
      args: data.args,
      env: data.env,
      enabled: data.enabled !== false,
    };

    tables.mcpServers.create(server);

    this.instances.set(id, {
      server,
      process: null,
      tools: [],
      status: "stopped",
    });

    return server;
  }

  update(id: string, data: Partial<MCPServer>): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    const updated = { ...instance.server, ...data };
    tables.mcpServers.update(id, updated);
    instance.server = updated;

    return true;
  }

  delete(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    if (instance.process) {
      this.stop(id);
    }

    this.instances.delete(id);
    const result = tables.mcpServers.delete(id);
    return result.changes > 0;
  }

  async start(id: string): Promise<{ success: boolean; error?: string }> {
    const instance = this.instances.get(id);
    if (!instance) {
      return { success: false, error: "Server not found" };
    }

    if (instance.status === "running") {
      return { success: true };
    }

    instance.status = "starting";
    this.emit("statusChange", { id, status: "starting" });

    if (isHttpMcpUrl(instance.server.url)) {
      return this.startHttp(id);
    }

    try {
      const { command, args } = instance.server;

      const cmdParts = command.split(/\s+/);
      const cmd = cmdParts[0];
      const cmdArgs = [...cmdParts.slice(1), ...(args?.split(/\s+/) || [])].filter(Boolean);

      const env: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => pair[1] !== undefined
        )
      );
      if (instance.server.env) {
        try {
          const envPairs = instance.server.env.split(",").map((s) => s.trim());
          for (const pair of envPairs) {
            const [key, value] = pair.split("=");
            if (key && value) {
              env[key.trim()] = value.trim();
            }
          }
        } catch {
          /* ignore */
        }
      }

      // Spawn the MCP server process
      const proc = spawn(cmd, cmdArgs, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      instance.process = proc;
      instance.startedAt = new Date();

      // Handle process events
      proc.stdout?.on("data", (data: Buffer) => {
        const message = data.toString();
        this.handleServerMessage(id, message);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        console.error(`[MCP ${instance.server.name}] stderr:`, data.toString());
      });

      proc.on("error", (error) => {
        instance.status = "error";
        instance.lastError = error.message;
        instance.process = null;
        this.emit("statusChange", { id, status: "error", error: error.message });
      });

      proc.on("exit", (code) => {
        if (instance.status !== "stopped") {
          instance.status = code === 0 ? "stopped" : "error";
          instance.lastError = code !== 0 ? `Process exited with code ${code}` : undefined;
        }
        instance.process = null;
        this.emit("statusChange", { id, status: instance.status });
      });

      // Wait for initialization
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // If process exited during startup, treat as failed start
      if (instance.process !== proc || proc.exitCode !== null) {
        const exitCode = proc.exitCode;
        const exitedMsg =
          exitCode === 0
            ? "MCP server exited before initialization"
            : `MCP server exited with code ${String(exitCode)}`;
        instance.status = exitCode === 0 ? "stopped" : "error";
        instance.lastError = exitedMsg;
        return { success: false, error: exitedMsg };
      }

      // Request tools list
      await this.requestTools(id);

      instance.status = "running";
      this.emit("statusChange", { id, status: "running" });

      return { success: true };
    } catch (error) {
      instance.status = "error";
      instance.lastError = (error as Error).message;
      instance.process = null;
      return { success: false, error: (error as Error).message };
    }
  }

  async stop(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) return false;

    if (instance.process) {
      instance.process.kill("SIGTERM");

      // Force kill after timeout
      setTimeout(() => {
        if (instance.process && !instance.process.killed) {
          instance.process.kill("SIGKILL");
        }
      }, 5000);
    }

    instance.status = "stopped";
    instance.process = null;
    instance.tools = [];
    this.emit("statusChange", { id, status: "stopped" });

    return true;
  }

  async restart(id: string): Promise<{ success: boolean; error?: string }> {
    await this.stop(id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.start(id);
  }

  private async httpRpc(
    instance: MCPServerInstance,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const url = instance.server.url as string;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (instance.httpSessionId) headers["Mcp-Session-Id"] = instance.httpSessionId;
    if (instance.server.env) {
      for (const pair of instance.server.env.split(",")) {
        const [k, v] = pair.split("=");
        if (k?.trim().toLowerCase() === "authorization" && v) headers.Authorization = v.trim();
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) instance.httpSessionId = sessionHeader;
    if (!response.ok) {
      throw new Error(`MCP HTTP ${method} -> ${response.status} ${response.statusText}`);
    }
    const parsed = parseMcpHttpResponse(
      response.headers.get("content-type") || "",
      await response.text()
    );
    if (parsed.error) throw new Error(parsed.error.message || "MCP HTTP error");
    return parsed.result;
  }

  private async startHttp(id: string): Promise<{ success: boolean; error?: string }> {
    const instance = this.instances.get(id);
    if (!instance) return { success: false, error: "Server not found" };
    try {
      await this.httpRpc(instance, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cybara", version: "1.0" },
      });
      const listed = (await this.httpRpc(instance, "tools/list", {})) as {
        tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }>;
      };
      instance.tools = (listed?.tools || [])
        .filter((t): t is { name: string; description?: string; inputSchema?: unknown } =>
          typeof t.name === "string"
        )
        .map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema:
            t.inputSchema && typeof t.inputSchema === "object"
              ? (t.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} },
        }));
      this.toolCache.set(id, instance.tools);
      instance.startedAt = new Date();
      instance.status = "running";
      this.emit("toolsUpdated", { id, tools: instance.tools });
      this.emit("statusChange", { id, status: "running" });
      return { success: true };
    } catch (error) {
      instance.status = "error";
      instance.lastError = (error as Error).message;
      return { success: false, error: (error as Error).message };
    }
  }

  private handleServerMessage(id: string, message: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    try {
      // Parse JSON-RPC messages from the MCP server
      const lines = message.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as MCPToolListResponse;
          if (Array.isArray(msg.result?.tools)) {
            // Tools list response
            instance.tools = msg.result.tools
              .filter(
                (tool): tool is { name: string; description?: string; inputSchema?: unknown } =>
                  typeof tool.name === "string"
              )
              .map((tool) => ({
                name: tool.name,
                description: tool.description || "",
                inputSchema:
                  tool.inputSchema && typeof tool.inputSchema === "object"
                    ? (tool.inputSchema as Record<string, unknown>)
                    : { type: "object", properties: {} },
              }));
            this.toolCache.set(id, instance.tools);
            this.emit("toolsUpdated", { id, tools: instance.tools });
          }
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      console.error(`[MCP ${instance.server.name}] Message parse error:`, error);
    }
  }

  private async requestTools(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance?.process?.stdin) return;

    const request = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {},
    };

    instance.process.stdin.write(JSON.stringify(request) + "\n");
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const instance = this.instances.get(serverId);
    if (!instance) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (isHttpMcpUrl(instance.server.url)) {
      if (instance.status !== "running") {
        throw new Error(`MCP server not running: ${instance.server.name}`);
      }
      return this.httpRpc(instance, "tools/call", { name: toolName, arguments: args });
    }

    if (instance.status !== "running" || !instance.process?.stdin) {
      throw new Error(`MCP server not running: ${instance.server.name}`);
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now();
      const timeout = setTimeout(() => {
        reject(new Error("MCP tool call timeout"));
      }, 30000);

      const responseHandler = (data: Buffer) => {
        try {
          const message = data.toString();
          const lines = message.split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.id === requestId) {
                clearTimeout(timeout);
                instance.process?.stdout?.off("data", responseHandler);

                if (msg.error) {
                  reject(new Error(msg.error.message || "MCP tool error"));
                } else {
                  resolve(msg.result);
                }
                return;
              }
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      };

      instance.process?.stdout?.on("data", responseHandler);

      const request = {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      };

      instance.process?.stdin?.write(JSON.stringify(request) + "\n");
    });
  }

  getAllTools(): Array<MCPTool & { serverId: string; serverName: string }> {
    const allTools: Array<MCPTool & { serverId: string; serverName: string }> = [];

    for (const [id, instance] of this.instances) {
      if (instance.status === "running") {
        for (const tool of instance.tools) {
          allTools.push({
            ...tool,
            serverId: id,
            serverName: instance.server.name,
          });
        }
      }
    }

    return allTools;
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    mcp_server: { id: string; name: string };
  }> {
    return this.getAllTools().map((tool) => ({
      name: `mcp_${tool.serverId.slice(0, 8)}_${tool.name}`,
      description: `[MCP: ${tool.serverName}] ${tool.description}`,
      input_schema: tool.inputSchema,
      mcp_server: { id: tool.serverId, name: tool.serverName },
    }));
  }
}

export const mcpManager = new MCPServerManager();
