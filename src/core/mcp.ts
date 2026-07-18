import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import { type MCPServer, tables } from "./database";
import { buildSubprocessEnvironment } from "./subprocess-env";
import { validateUrl } from "../api/security";
import {
  decodeMcpOAuthEnvironment,
  isHttpMcpUrl,
  normalizeRemoteMcpUrl,
  parseMcpHttpResponse,
  refreshMcpOAuthCredential,
  replaceMcpOAuthEnvironment,
} from "./mcp-http";

/**
 * Monotonic JSON-RPC request id. Using Date.now() (as before) collided when two
 * calls landed in the same millisecond, cross-wiring one caller's handler onto
 * another's response.
 */
let mcpRequestSeq = 0;
export function nextMcpRequestId(): number {
  mcpRequestSeq = (mcpRequestSeq + 1) % Number.MAX_SAFE_INTEGER;
  return mcpRequestSeq;
}

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
  stdoutBuffer?: string;
  pendingRequests: Map<number, MCPPendingRequest>;
}

interface MCPPendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface MCPServerSummary extends Omit<MCPServer, "env"> {
  status: string;
  toolCount: number;
  hasCredentials: boolean;
  transport: "stdio" | "http";
}

/**
 * Split a stdout accumulator into complete newline-delimited lines, returning
 * any trailing partial line to carry into the next chunk. Without this, a
 * JSON-RPC message larger than one pipe chunk is split across `data` events,
 * never parses, and the tool call hangs until its timeout.
 */
export function drainNdjsonLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

interface MCPJsonRpcResponse {
  id?: string | number | null;
  result?: unknown;
  error?: { message?: string };
}

function parseMcpTools(value: unknown): MCPTool[] | undefined {
  if (!value || typeof value !== "object" || !("tools" in value)) return undefined;
  const tools = (value as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return undefined;
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return [];
    const candidate = tool as {
      name?: unknown;
      description?: unknown;
      inputSchema?: unknown;
    };
    if (typeof candidate.name !== "string") return [];
    return [
      {
        name: candidate.name,
        description: typeof candidate.description === "string" ? candidate.description : "",
        inputSchema:
          candidate.inputSchema && typeof candidate.inputSchema === "object"
            ? (candidate.inputSchema as Record<string, unknown>)
            : { type: "object", properties: {} },
      },
    ];
  });
}

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
          pendingRequests: new Map(),
        });
      }
    } catch (error) {
      console.error("[MCP] Failed to load servers from database:", error);
    }
  }

  list(): MCPServerSummary[] {
    const result: MCPServerSummary[] = [];

    for (const [, instance] of this.instances) {
      const { env, ...server } = instance.server;
      result.push({
        ...server,
        status: instance.status,
        toolCount: instance.tools.length,
        hasCredentials: Boolean(env),
        transport: isHttpMcpUrl(instance.server.url) ? "http" : "stdio",
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
    command?: string;
    args?: string;
    env?: string;
    url?: string;
    enabled?: boolean;
  }): MCPServer {
    const name = data.name.trim();
    if (!name) throw new Error("MCP server name is required");
    const url = data.url ? normalizeRemoteMcpUrl(data.url) : undefined;
    const command = data.command?.trim() || "";
    if (!url && !command) throw new Error("MCP command is required for local servers");
    const id = crypto.randomUUID();
    const server: MCPServer = {
      id,
      name,
      command,
      args: data.args,
      env: data.env,
      url,
      enabled: data.enabled !== false,
    };

    tables.mcpServers.create(server);

    this.instances.set(id, {
      server,
      process: null,
      tools: [],
      status: "stopped",
      pendingRequests: new Map(),
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

      const env = buildSubprocessEnvironment();
      if (instance.server.env) {
        try {
          const envPairs = instance.server.env.split(",").map((s) => s.trim());
          for (const pair of envPairs) {
            const separator = pair.indexOf("=");
            const key = separator >= 0 ? pair.slice(0, separator) : "";
            const value = separator >= 0 ? pair.slice(separator + 1) : "";
            if (key && value) {
              env[key.trim()] = value.trim();
            }
          }
        } catch {
          /* ignore */
        }
      }

      const proc = spawn(cmd, cmdArgs, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      instance.process = proc;
      instance.startedAt = new Date();
      instance.stdoutBuffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        instance.stdoutBuffer = (instance.stdoutBuffer ?? "") + data.toString();
        const { lines, rest } = drainNdjsonLines(instance.stdoutBuffer);
        instance.stdoutBuffer = rest;
        for (const line of lines) {
          this.handleServerMessage(id, line);
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        console.error(`[MCP ${instance.server.name}] stderr:`, data.toString());
      });

      proc.on("error", (error) => {
        this.rejectPendingRequests(instance, error);
        instance.status = "error";
        instance.lastError = error.message;
        instance.process = null;
        this.emit("statusChange", { id, status: "error", error: error.message });
      });

      proc.on("exit", (code) => {
        this.rejectPendingRequests(
          instance,
          new Error(`MCP server exited with code ${String(code)}`)
        );
        if (instance.status !== "stopped") {
          instance.status = code === 0 ? "stopped" : "error";
          instance.lastError = code !== 0 ? `Process exited with code ${code}` : undefined;
        }
        instance.process = null;
        this.emit("statusChange", { id, status: instance.status });
      });

      await this.stdioRpc(instance, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cybara", version: "1.0" },
      });
      this.sendStdioNotification(instance, "notifications/initialized", {});
      const listed = await this.stdioRpc(instance, "tools/list", {});
      instance.tools = parseMcpTools(listed) ?? [];
      this.toolCache.set(id, instance.tools);
      this.emit("toolsUpdated", { id, tools: instance.tools });

      instance.status = "running";
      this.emit("statusChange", { id, status: "running" });

      return { success: true };
    } catch (error) {
      this.rejectPendingRequests(
        instance,
        error instanceof Error ? error : new Error(String(error))
      );
      instance.process?.kill("SIGTERM");
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
      const proc = instance.process;
      proc.kill("SIGTERM");

      const escalation = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill("SIGKILL");
        }
      }, 5000);
      escalation.unref();
    }

    instance.status = "stopped";
    this.rejectPendingRequests(instance, new Error("MCP server stopped"));
    instance.process = null;
    instance.tools = [];
    this.toolCache.delete(id);
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
    params: Record<string, unknown>,
    notification = false,
    retryAuthorization = true
  ): Promise<unknown> {
    const url = instance.server.url as string;
    const validation = await validateUrl(url);
    if (!validation.valid) {
      throw new Error(`Remote MCP URL blocked: ${validation.error || "unsafe URL"}`);
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (instance.httpSessionId) headers["Mcp-Session-Id"] = instance.httpSessionId;
    if (method !== "initialize") headers["MCP-Protocol-Version"] = "2025-06-18";
    let oauth = decodeMcpOAuthEnvironment(instance.server.env);
    if (oauth?.expiresAt && oauth.expiresAt <= Date.now() && oauth.refreshToken) {
      oauth = await refreshMcpOAuthCredential(oauth);
      const env = replaceMcpOAuthEnvironment(instance.server.env, oauth);
      this.update(instance.server.id, { env });
    }
    if (oauth?.accessToken) headers.Authorization = `Bearer ${oauth.accessToken}`;
    if (instance.server.env) {
      for (const pair of instance.server.env.split(",")) {
        const separator = pair.indexOf("=");
        if (separator < 0) continue;
        const key = pair.slice(0, separator).trim().toLowerCase();
        const value = pair.slice(separator + 1).trim();
        if (key === "authorization" && value) headers.Authorization = value;
      }
    }

    const request = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: nextMcpRequestId(), method, params };
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) instance.httpSessionId = sessionHeader;
    if (response.status === 401 && retryAuthorization && oauth?.refreshToken) {
      const refreshed = await refreshMcpOAuthCredential(oauth);
      const env = replaceMcpOAuthEnvironment(instance.server.env, refreshed);
      this.update(instance.server.id, { env });
      return this.httpRpc(instance, method, params, notification, false);
    }
    if (!response.ok) {
      throw new Error(`MCP HTTP ${method} -> ${response.status} ${response.statusText}`);
    }
    if (notification || response.status === 202 || response.status === 204) return undefined;
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
      await this.httpRpc(instance, "notifications/initialized", {}, true);
      const listed = (await this.httpRpc(instance, "tools/list", {})) as {
        tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }>;
      };
      instance.tools = (listed?.tools || [])
        .filter(
          (t): t is { name: string; description?: string; inputSchema?: unknown } =>
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

    let response: MCPJsonRpcResponse;
    try {
      response = JSON.parse(message) as MCPJsonRpcResponse;
    } catch {
      return;
    }

    if (typeof response.id === "number") {
      const pending = instance.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        instance.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message || "MCP request failed"));
        } else {
          pending.resolve(response.result);
        }
      }
    }

    const tools = parseMcpTools(response.result);
    if (tools) {
      instance.tools = tools;
      this.toolCache.set(id, tools);
      this.emit("toolsUpdated", { id, tools });
    }
  }

  private rejectPendingRequests(instance: MCPServerInstance, error: Error): void {
    for (const pending of instance.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    instance.pendingRequests.clear();
  }

  private sendStdioNotification(
    instance: MCPServerInstance,
    method: string,
    params: Record<string, unknown>
  ): void {
    if (!instance.process?.stdin)
      throw new Error(`MCP server not running: ${instance.server.name}`);
    instance.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private stdioRpc(
    instance: MCPServerInstance,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!instance.process?.stdin) {
      return Promise.reject(new Error(`MCP server not running: ${instance.server.name}`));
    }
    const requestId = nextMcpRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        instance.pendingRequests.delete(requestId);
        reject(new Error(`MCP ${method} timeout`));
      }, 30_000);
      instance.pendingRequests.set(requestId, { resolve, reject, timeout });
      try {
        instance.process?.stdin?.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`
        );
      } catch (error) {
        clearTimeout(timeout);
        instance.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
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

    return this.stdioRpc(instance, "tools/call", { name: toolName, arguments: args });
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
